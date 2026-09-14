import { placeNodes } from "./layout";
import { forceLayout } from "./forceLayout";
self.onmessage = ({ data }) => {
  if (data.mode === "force") {
    // Report the graph settling so a large theme shows progress instead of a frozen blob.
    const positions = forceLayout(data.ids, data.edges, data.positions, {
      onProgress: (progress, frame) =>
        self.postMessage({ request: data.request, mode: "force", progress, positions: frame }),
    });
    self.postMessage({ request: data.request, mode: "force", progress: 1, positions });
    return;
  }
  self.postMessage({
    request: data.request,
    positions: placeNodes(data.ids, data.edges, data.positions),
  });
};
