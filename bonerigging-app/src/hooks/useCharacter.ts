import { useCallback, type Dispatch } from 'react';
import { SVGParser } from '../core/svg-parser';
import { RasterParser } from '../core/raster-parser';
import { MeshGenerator } from '../core/mesh-generator';
import { AutoRigger } from '../core/auto-rigger';
import { SkinWeightCalculator } from '../core/skin-weight-calculator';
import type { CharacterAction } from '../contexts/CharacterContext';

/**
 * Hook that encapsulates the file-loading, parsing, and auto-rigging pipeline.
 *
 * Given a File (SVG or raster image), it:
 *   1. Parses the file into a ParsedCharacter
 *   2. Auto-generates a skeleton via AutoRigger
 *   3. Computes skin weights (for SVG control points or mesh vertices)
 *   4. Optionally generates a deformation mesh (raster mode)
 *   5. Dispatches SET_CHARACTER to the CharacterContext
 */
export function useCharacter(dispatch: Dispatch<CharacterAction>) {
  const loadFile = useCallback(async (file: File) => {
    const name = file.name.toLowerCase();
    const isImage = /\.(png|jpg|jpeg|webp|gif|bmp)$/.test(name);

    if (isImage) {
      // ------------------------------------------------------------------
      // Raster image pipeline
      // ------------------------------------------------------------------
      const url = URL.createObjectURL(file);
      const img = new Image();

      img.onload = () => {
        try {
          const parsed = RasterParser.parse(img);
          const skeleton = AutoRigger.createSkeleton(parsed);
          const mesh = MeshGenerator.generate(
            parsed.bbox,
            20,
            30,
            img.naturalWidth,
            img.naturalHeight,
            parsed.alphaGrid ?? null,
          );
          const weights = SkinWeightCalculator.compute(
            mesh.vertices,
            skeleton,
            parsed.bbox,
          );

          dispatch({
            type: 'SET_CHARACTER',
            parsed,
            skeleton,
            weights,
            mesh,
            mode: 'raster' as const,
            rasterImage: img,
          });
        } finally {
          URL.revokeObjectURL(url);
        }
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
      };

      img.src = url;
    } else {
      // ------------------------------------------------------------------
      // SVG pipeline
      // ------------------------------------------------------------------
      const text = await file.text();
      const parsed = SVGParser.parse(text);
      const skeleton = AutoRigger.createSkeleton(parsed);
      const weights = SkinWeightCalculator.compute(
        parsed.allControlPoints,
        skeleton,
        parsed.bbox,
      );

      dispatch({
        type: 'SET_CHARACTER',
        parsed,
        skeleton,
        weights,
        mesh: null,
        mode: 'svg' as const,
        rasterImage: null,
      });
    }
  }, [dispatch]);

  return { loadFile };
}
