import { placeNodes } from "./layout";
self.onmessage = ({ data }) =>
  self.postMessage({
    request: data.request,
    positions: placeNodes(data.ids, data.edges, data.positions),
  });
