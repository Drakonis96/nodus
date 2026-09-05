import { useState, useCallback, useEffect, useRef } from "react";
import type { GraphData } from "@shared/types";
import type { StellarPosition } from "@shared/stellarGraph";
import { StellarCanvas, type StellarCanvasApi } from "./StellarCanvas";
import { cleanGraph } from "./source";
import { useMemo } from "react";
export function StellarExcerpt({
  data,
  onOpenNode,
}: {
  data: GraphData;
  onOpenNode: (id: string) => void;
}) {
  const graph = useMemo(() => cleanGraph(data), [data]);
  const [positions, setPositions] = useState<Record<string, StellarPosition>>(
    {},
  );
  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 0.5 });
  const api = useRef<StellarCanvasApi | null>(null),
    fitted = useRef(false);
  const bind = useCallback((a: StellarCanvasApi | null) => {
    api.current = a;
  }, []);
  useEffect(() => {
    if (
      !fitted.current &&
      graph.nodes.length &&
      graph.nodes.every((n) => positions[n.id])
    ) {
      api.current?.fit();
      fitted.current = true;
    }
  }, [graph, positions]);
  return (
    <div className="stellar-workspace" style={{minHeight:"100%"}}>
      <StellarCanvas
        data={graph}
        positions={positions}
        camera={camera}
        onPositions={setPositions}
        onCamera={setCamera}
        onNode={onOpenNode}
        onEdge={() => {}}
        onApi={bind}
      />
    </div>
  );
}
