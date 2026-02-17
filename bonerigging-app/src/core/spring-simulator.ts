import type { Vec2 } from '../types/math';
import type { Skeleton } from '../types/skeleton';
import { V2, v2Add, v2Sub, v2Scale, v2Len } from './math';

/**
 * Per-joint simulation state within a spring chain.
 */
export interface SpringState {
  jointName: string;
  velocity: Vec2;
  simulatedPosition: Vec2 | null;
}

/**
 * A chain of joints driven by spring physics.
 * The root joint is the fixed anchor; the joints array contains
 * all descendant joints that respond to spring forces.
 */
export interface SpringChain {
  rootJoint: string;
  joints: string[];
  stiffness: number;
  damping: number;
  gravity: Vec2;
  states: SpringState[];
}

/**
 * Create a spring chain rooted at `jointName`.
 * Collects all descendant joints (via bones) and initialises their
 * simulation state.
 */
export function createSpringChain(
  jointName: string,
  skeleton: Skeleton,
  stiffness: number,
  damping: number,
  gravity: Vec2
): SpringChain {
  const jointNames: string[] = [];

  const collect = (name: string): void => {
    for (const b of skeleton.bones) {
      if (b.from === name) {
        jointNames.push(b.to);
        collect(b.to);
      }
    }
  };
  collect(jointName);

  return {
    rootJoint: jointName,
    joints: jointNames,
    stiffness,
    damping,
    gravity,
    states: jointNames.map((j) => ({
      jointName: j,
      velocity: V2(0, 0),
      simulatedPosition: null,
    })),
  };
}

/**
 * Step the spring simulation forward by `dt` seconds.
 * Mutates both the chain states and `skeleton.joints[*].current` in place.
 */
export function simulateSprings(
  chains: SpringChain[],
  skeleton: Skeleton,
  dt: number
): void {
  for (const chain of chains) {
    for (let i = 0; i < chain.joints.length; i++) {
      const st = chain.states[i];
      const joint = skeleton.joints[st.jointName];
      if (!joint) continue;

      // FK target = current joint position (set by drag/FK propagation)
      const fkTarget = joint.current;
      if (!st.simulatedPosition) {
        st.simulatedPosition = V2(fkTarget.x, fkTarget.y);
      }

      // Spring force toward FK target
      const dx = fkTarget.x - st.simulatedPosition.x;
      const dy = fkTarget.y - st.simulatedPosition.y;
      const fx = dx * chain.stiffness + chain.gravity.x;
      const fy = dy * chain.stiffness + chain.gravity.y;

      // Integrate velocity
      st.velocity.x = (st.velocity.x + fx * dt) * Math.pow(chain.damping, dt * 60);
      st.velocity.y = (st.velocity.y + fy * dt) * Math.pow(chain.damping, dt * 60);

      // Integrate position
      st.simulatedPosition.x += st.velocity.x * dt;
      st.simulatedPosition.y += st.velocity.y * dt;

      // Constrain bone length from parent
      const parentName = joint.parent;
      const parentJoint = parentName ? skeleton.joints[parentName] : null;
      if (parentJoint) {
        const parentPos: Vec2 =
          i > 0
            ? chain.states[i - 1].simulatedPosition || parentJoint.current
            : parentJoint.current;
        const bone = skeleton.bones.find(
          (b) => b.from === parentName && b.to === st.jointName
        );
        if (bone) {
          const dir = v2Sub(st.simulatedPosition, parentPos);
          const len = v2Len(dir);
          if (len > 0.001) {
            const norm = v2Scale(dir, 1 / len);
            st.simulatedPosition = v2Add(parentPos, v2Scale(norm, bone.restLength));
          }
        }
      }

      // Override joint position
      joint.current = V2(st.simulatedPosition.x, st.simulatedPosition.y);
    }
  }
}
