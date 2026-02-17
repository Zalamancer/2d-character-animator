export interface BoneWeight {
  boneIndex: number;
  weight: number;
  boneName: string;
  t: number; // projection along bone (0=head, 1=tail)
}
