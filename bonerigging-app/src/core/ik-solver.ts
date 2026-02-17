import type { Vec2 } from '../types/math';
import type { Skeleton } from '../types/skeleton';
import { V2, v2Add, v2Sub, v2Scale, v2Norm, v2Len, v2Dist, v2Rot } from './math';

/**
 * Collect the bone chain from the dragged joint up to the nearest pinned
 * ancestor (or the skeleton root). Returns an array of joint names ordered
 * from the root/anchor down to the dragged joint.
 *
 * Example return: ['leftShoulder', 'leftElbow', 'leftWrist']
 */
export function getIKChain(
  jointName: string,
  skeleton: Skeleton,
  pinnedJoints: Set<string>
): string[] {
  const chain: string[] = [];
  let current: string | null = jointName;

  while (current) {
    chain.unshift(current);
    // If we hit a pinned joint (other than the dragged one), that's our root
    if (current !== jointName && pinnedJoints.has(current)) break;
    // Walk up
    const parentBone = skeleton.bones.find((b) => b.to === current);
    if (!parentBone) break; // reached root
    current = parentBone.from;
    // If the parent is pinned, add it as root and stop
    if (pinnedJoints.has(current)) {
      chain.unshift(current);
      break;
    }
  }

  return chain;
}

/**
 * Get bone lengths between consecutive joints in the chain.
 */
function getChainBoneLengths(chain: string[], skeleton: Skeleton): number[] {
  const lengths: number[] = [];
  for (let i = 0; i < chain.length - 1; i++) {
    const bone = skeleton.bones.find(
      (b) =>
        (b.from === chain[i] && b.to === chain[i + 1]) ||
        (b.from === chain[i + 1] && b.to === chain[i])
    );
    lengths.push(
      bone
        ? bone.restLength
        : v2Dist(skeleton.joints[chain[i]].rest, skeleton.joints[chain[i + 1]].rest)
    );
  }
  return lengths;
}

/**
 * Drag a joint to `targetPos` using FABRIK IK, keeping bone lengths rigid.
 * Mutates `skeleton.joints[*].current` in place.
 *
 * @param isSpringJoint - callback that returns true when a joint is driven by
 *   spring physics and should not be moved by FK propagation.
 */
export function applyRigidDrag(
  jointName: string,
  targetPos: Vec2,
  skeleton: Skeleton,
  pinnedJoints: Set<string>,
  isSpringJoint: (name: string) => boolean
): void {
  const joint = skeleton.joints[jointName];
  if (pinnedJoints.has(jointName)) return;

  // Save pinned joint positions so we can guarantee they don't move
  const pinnedPositions = new Map<string, Vec2>();
  for (const name of pinnedJoints) {
    const j = skeleton.joints[name];
    if (j) pinnedPositions.set(name, V2(j.current.x, j.current.y));
  }

  // Get the IK chain from pinned root to this joint
  const chain = getIKChain(jointName, skeleton, pinnedJoints);

  if (chain.length < 2) {
    // Root joint or no chain -- just translate
    joint.current = targetPos;
    propagateRigidFK(jointName, skeleton, pinnedJoints, isSpringJoint);
    // Restore pinned positions
    for (const [name, pos] of pinnedPositions) {
      skeleton.joints[name].current = pos;
    }
    return;
  }

  // Get bone lengths
  const lengths = getChainBoneLengths(chain, skeleton);
  const totalLength = lengths.reduce((a, b) => a + b, 0);

  // Get current positions
  const positions: Vec2[] = chain.map((n) =>
    V2(skeleton.joints[n].current.x, skeleton.joints[n].current.y)
  );

  const rootPos = positions[0]; // fixed anchor
  const target = targetPos;

  // Clamp target to reachable distance
  const distToTarget = v2Dist(rootPos, target);
  let clampedTarget = target;
  if (distToTarget > totalLength * 0.999) {
    // Fully stretched -- point everything toward target
    const dir = v2Norm(v2Sub(target, rootPos));
    clampedTarget = v2Add(rootPos, v2Scale(dir, totalLength * 0.999));
  }

  // FABRIK IK solver
  const maxIter = 10;
  const tolerance = 0.5;

  for (let iter = 0; iter < maxIter; iter++) {
    // --- Backward pass: from end-effector to root ---
    positions[positions.length - 1] = V2(clampedTarget.x, clampedTarget.y);
    for (let i = positions.length - 2; i >= 0; i--) {
      const dir = v2Sub(positions[i], positions[i + 1]);
      const len = v2Len(dir);
      if (len < 0.001) {
        positions[i] = v2Add(positions[i + 1], V2(lengths[i], 0));
      } else {
        positions[i] = v2Add(positions[i + 1], v2Scale(v2Norm(dir), lengths[i]));
      }
    }

    // --- Forward pass: from root to end-effector ---
    positions[0] = V2(rootPos.x, rootPos.y); // root stays fixed
    for (let i = 0; i < positions.length - 1; i++) {
      const dir = v2Sub(positions[i + 1], positions[i]);
      const len = v2Len(dir);
      if (len < 0.001) {
        positions[i + 1] = v2Add(positions[i], V2(lengths[i], 0));
      } else {
        positions[i + 1] = v2Add(positions[i], v2Scale(v2Norm(dir), lengths[i]));
      }
    }

    // Check convergence
    if (v2Dist(positions[positions.length - 1], clampedTarget) < tolerance) break;
  }

  // Write solved positions back to skeleton
  for (let i = 1; i < chain.length; i++) {
    skeleton.joints[chain[i]].current = positions[i];
  }

  // Build a set of chain joints so FK propagation skips them
  const chainSet = new Set(chain);

  // Propagate to children of the dragged joint (beyond the chain)
  propagateRigidFK(jointName, skeleton, pinnedJoints, isSpringJoint, chainSet);

  // Also propagate children of intermediate chain joints (e.g. elbow may have
  // forearm children) but skip joints that are already part of the IK chain
  for (let i = 1; i < chain.length - 1; i++) {
    propagateRigidFK(chain[i], skeleton, pinnedJoints, isSpringJoint, chainSet);
  }

  // Final safety: restore ALL pinned joint positions to guarantee they don't move
  for (const [name, pos] of pinnedPositions) {
    skeleton.joints[name].current = pos;
  }
}

/**
 * Propagate rigid FK (forward kinematics) from a joint to its children,
 * maintaining bone lengths. Used after IK solve to update descendants.
 *
 * @param skipSet - optional set of joint names to skip (already solved by IK)
 * @param isSpringJoint - callback returning true for physics-driven joints
 */
export function propagateRigidFK(
  jointName: string,
  skeleton: Skeleton,
  pinnedJoints: Set<string>,
  isSpringJoint: (name: string) => boolean,
  skipSet?: Set<string>
): void {
  const joint = skeleton.joints[jointName];
  const childBones = skeleton.bones.filter((b) => b.from === jointName);

  for (const bone of childBones) {
    const childJointName = bone.to;
    const childJoint = skeleton.joints[childJointName];

    if (pinnedJoints.has(childJointName)) continue;

    // Skip joints that are part of the IK chain (already solved by FABRIK)
    if (skipSet && skipSet.has(childJointName)) continue;

    // Skip spring joints -- they are driven by physics simulation
    if (isSpringJoint(childJointName)) continue;

    // Compute rotation delta at this joint
    const parentBone = skeleton.bones.find((b) => b.to === jointName);
    let deltaAngle = 0;

    if (parentBone) {
      const grandParent = skeleton.joints[parentBone.from];
      const restDir = v2Sub(joint.rest, grandParent.rest);
      const curDir = v2Sub(joint.current, grandParent.current);
      if (v2Len(restDir) > 0.001 && v2Len(curDir) > 0.001) {
        deltaAngle = Math.atan2(curDir.y, curDir.x) - Math.atan2(restDir.y, restDir.x);
      }
    }

    // Rotate child maintaining bone length
    const restOffset = v2Sub(childJoint.rest, joint.rest);
    const rotated = v2Rot(restOffset, deltaAngle);
    const norm = v2Norm(rotated);
    const newPos = v2Add(joint.current, v2Scale(norm, bone.restLength));

    childJoint.current = newPos;
    propagateRigidFK(childJointName, skeleton, pinnedJoints, isSpringJoint, skipSet);
  }
}

/**
 * Propagate standard (non-rigid) FK from a joint to its children.
 * In edit mode all children are moved; in pose mode pinned children are skipped.
 *
 * @param editMode - when true, pinned joints are still propagated
 * @param isSpringJoint - callback returning true for physics-driven joints
 */
export function propagateFK(
  jointName: string,
  skeleton: Skeleton,
  editMode: boolean,
  pinnedJoints: Set<string>,
  isSpringJoint: (name: string) => boolean
): void {
  const joint = skeleton.joints[jointName];

  // Find all bones where this joint is the "from" (head) end
  const childBones = skeleton.bones.filter((b) => b.from === jointName);

  for (const bone of childBones) {
    const childJointName = bone.to;
    const childJoint = skeleton.joints[childJointName];

    // If pinned in pose mode, skip
    if (!editMode && pinnedJoints.has(childJointName)) continue;

    // Skip spring joints -- they are driven by physics simulation
    if (isSpringJoint(childJointName)) continue;

    const parentBone = skeleton.bones.find((b) => b.to === jointName);

    if (parentBone) {
      const grandParent = skeleton.joints[parentBone.from];
      const restDir = v2Sub(joint.rest, grandParent.rest);
      const curDir = v2Sub(joint.current, grandParent.current);
      const restAngle = Math.atan2(restDir.y, restDir.x);
      const curAngle = Math.atan2(curDir.y, curDir.x);
      const deltaAngle = curAngle - restAngle;

      const restOffset = v2Sub(childJoint.rest, joint.rest);
      const rotatedOffset = v2Rot(restOffset, deltaAngle);
      const translation = v2Sub(joint.current, joint.rest);

      childJoint.current = v2Add(v2Add(joint.rest, translation), rotatedOffset);
    } else {
      const delta = v2Sub(joint.current, joint.rest);
      childJoint.current = v2Add(childJoint.rest, delta);
    }

    propagateFK(childJointName, skeleton, editMode, pinnedJoints, isSpringJoint);
  }
}
