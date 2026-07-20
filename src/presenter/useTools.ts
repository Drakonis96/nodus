// PDF Presenter — the tool interaction hook shared by the audience and presenter
// windows. It owns a ToolOverlayController over the slide wrapper, turns local
// mouse input on the slide into ToolData (which it emits so the other window
// mirrors it), routes incoming tool actions to the controller, and binds the
// ⌘L/⌘D/⌘P/⌘M shortcuts. Coordinates are percentages of the slide wrapper.
import type React from 'react';
import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { ToolOverlayController } from '../lib/presenter/tools';
import type { PresenterAction, PresenterRuntimeState, ToolName } from '@shared/presenterState';

interface UseToolsOpts {
  /** The tight wrapper around the slide canvas (overlays + coordinate basis). */
  stageRef: RefObject<HTMLElement | null>;
  getSlideCanvas: () => HTMLCanvasElement | null;
  /** Latest runtime state (active tool, color, sizes). */
  getState: () => PresenterRuntimeState;
  /** Emit a local action (applied here + relayed to the other window). */
  emit: (action: PresenterAction) => void;
}

const SHORTCUT_TOOL: Record<string, ToolName> = { l: 'flashlight', d: 'draw', p: 'pointer', m: 'zoom' };

export function useTools({ stageRef, getSlideCanvas, getState, emit }: UseToolsOpts) {
  const controllerRef = useRef<ToolOverlayController | null>(null);
  const drawingRef = useRef(false);
  const emitRef = useRef(emit);
  const stateRef = useRef(getState);
  emitRef.current = emit;
  stateRef.current = getState;

  useEffect(() => {
    if (!stageRef.current) return;
    controllerRef.current = new ToolOverlayController(stageRef.current, getSlideCanvas);
    return () => {
      controllerRef.current?.destroy();
      controllerRef.current = null;
    };
    // stageRef/getSlideCanvas are stable refs for the window's lifetime.
  }, [stageRef, getSlideCanvas]);

  /** Route a tool-related action to the overlay controller (local or relayed). */
  const apply = useCallback((action: PresenterAction) => {
    const c = controllerRef.current;
    if (!c) return;
    switch (action.type) {
      case 'setTool':
        c.setActiveTool(action.tool);
        break;
      case 'setToolSize':
        c.setSize(action.tool, action.size);
        break;
      case 'setZoomFactor':
        c.setZoomFactor(action.factor);
        break;
      case 'toolData':
        c.applyToolData(action.data);
        break;
      case 'clearDraw':
        c.clearDraw();
        break;
    }
  }, []);

  /** Re-fit the draw canvas and clear it on slide change / resize. */
  const onSlideChanged = useCallback(() => {
    controllerRef.current?.clearDraw();
    controllerRef.current?.resizeDrawToStage();
  }, []);

  const posFromEvent = (e: { clientX: number; clientY: number }) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return { x: 50, y: 50 };
    return {
      x: Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100)),
      y: Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100)),
    };
  };

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const st = stateRef.current();
    if (st.toolMode !== 'draw') return;
    const { x, y } = posFromEvent(e);
    drawingRef.current = true;
    emitRef.current({
      type: 'toolData',
      data: { tool: 'draw', action: 'start', x, y, color: st.toolColor, lineWidth: Math.max(1, st.toolSizes.draw) },
    });
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const st = stateRef.current();
    const tool = st.toolMode;
    if (!tool) return;
    const { x, y } = posFromEvent(e);
    if (tool === 'draw') {
      if (!drawingRef.current) return;
      emitRef.current({
        type: 'toolData',
        data: { tool: 'draw', action: 'move', x, y, color: st.toolColor, lineWidth: Math.max(1, st.toolSizes.draw) },
      });
    } else if (tool === 'flashlight') {
      emitRef.current({ type: 'toolData', data: { tool: 'flashlight', x, y, r: st.toolSizes.flashlight } });
    } else if (tool === 'pointer') {
      emitRef.current({ type: 'toolData', data: { tool: 'pointer', x, y, size: st.toolSizes.pointer } });
    } else if (tool === 'zoom') {
      emitRef.current({ type: 'toolData', data: { tool: 'zoom', x, y } });
    }
  }, []);

  const onMouseUp = useCallback(() => {
    if (drawingRef.current) {
      drawingRef.current = false;
      emitRef.current({ type: 'toolData', data: { tool: 'draw', action: 'end' } });
    }
  }, []);

  // ⌘/Ctrl + L/D/P/M toggle a tool.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey) return;
      const tool = SHORTCUT_TOOL[e.key.toLowerCase()];
      if (!tool) return;
      e.preventDefault();
      const active = stateRef.current().toolMode;
      emitRef.current({ type: 'setTool', tool: active === tool ? null : tool });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return { apply, onSlideChanged, onMouseDown, onMouseMove, onMouseUp };
}
