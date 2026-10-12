"use client";

import { useEffect, useId, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { createSignatureInput, signaturePoint, type SignaturePoint } from "./signature-input";

export type { SignaturePoint } from "./signature-input";

function paint(canvas: HTMLCanvasElement | null, strokes: SignaturePoint[][], preview: readonly SignaturePoint[] = []) {
  const context = canvas?.getContext("2d");
  if (!canvas || !context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "#1d2522";
  context.lineWidth = 3;
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const stroke of [...strokes, preview]) {
    context.beginPath();
    stroke.forEach((point, index) => {
      if (!index) context.moveTo(point.x * canvas.width, point.y * canvas.height);
      else context.lineTo(point.x * canvas.width, point.y * canvas.height);
    });
    context.stroke();
  }
}

function releaseCapture(canvas: HTMLCanvasElement | null, source: number | "keyboard" | null) {
  if (typeof source !== "number" || !canvas?.hasPointerCapture(source)) return;
  canvas.releasePointerCapture(source);
}

export function SignaturePad({ strokes, onChange, disabled, label = 'Draw your demonstration signature *' }: { strokes: SignaturePoint[][]; onChange: (value: SignaturePoint[][]) => void; disabled: boolean; label?: string }) {
  const signatureId = useId();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef(createSignatureInput());
  const cursor = useRef<SignaturePoint>({ x: 0.15, y: 0.5 });
  const redraw = () => paint(canvasRef.current, strokes, inputRef.current.preview());

  useEffect(() => {
    const canvas = canvasRef.current, input = inputRef.current;
    const source = input.source();
    input.cancel();
    releaseCapture(canvas, source);
    paint(canvas, strokes);
    return () => {
      const active = input.source();
      input.cancel();
      releaseCapture(canvas, active);
    };
  }, [strokes, disabled]);

  function point(event: PointerEvent<HTMLCanvasElement>) {
    return signaturePoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect());
  }
  function cancel(source?: number | "keyboard") {
    const active = inputRef.current.source();
    if (!inputRef.current.cancel(source)) return;
    releaseCapture(canvasRef.current, active);
    redraw();
  }
  function finish(source: number | "keyboard", end: SignaturePoint | null) {
    const stroke = inputRef.current.finish(source, end, strokes, disabled);
    releaseCapture(canvasRef.current, source);
    if (stroke) onChange([...strokes, stroke]);
    else redraw();
  }
  function keyboard(event: KeyboardEvent<HTMLCanvasElement>) {
    if (disabled || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " ", "Enter", "Escape"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Escape") cancel();
    else if (inputRef.current.source() !== null && inputRef.current.source() !== "keyboard") return;
    else if (event.key === " " || event.key === "Enter") {
      if (inputRef.current.source() === "keyboard") finish("keyboard", null);
      else inputRef.current.begin("keyboard", cursor.current, strokes, disabled);
    } else {
      cursor.current = {
        x: Math.max(0, Math.min(1, cursor.current.x + (event.key === "ArrowRight" ? .015 : event.key === "ArrowLeft" ? -.015 : 0))),
        y: Math.max(0, Math.min(1, cursor.current.y + (event.key === "ArrowDown" ? .04 : event.key === "ArrowUp" ? -.04 : 0))),
      };
      inputRef.current.move("keyboard", cursor.current, strokes, disabled);
      redraw();
    }
    const canvas = canvasRef.current, context = canvas?.getContext("2d");
    if (canvas && context) {
      context.fillStyle = "#236461";
      context.fillRect(cursor.current.x * canvas.width - 3, cursor.current.y * canvas.height - 3, 6, 6);
    }
  }

  return <div className="demo-signature">
    <p id={`${signatureId}-label`}><strong>{label}</strong></p>
    <p id={`${signatureId}-help`} className="enquiry-hint">Use your mouse or finger. Keyboard: focus the pad, use arrows to position the pen, press Space to start, arrows to draw, then Enter to finish a stroke.</p>
    <canvas ref={canvasRef} width={800} height={240} tabIndex={disabled ? -1 : 0} aria-labelledby={`${signatureId}-label`} aria-describedby={`${signatureId}-help`} aria-disabled={disabled} onKeyDown={keyboard}
      onPointerDown={event => {
        if (disabled || !event.isPrimary || event.button !== 0) return;
        const start = point(event);
        if (!start || inputRef.current.source() !== null) return;
        event.preventDefault();
        event.currentTarget.focus();
        if (!inputRef.current.begin(event.pointerId, start, strokes, disabled)) return;
        try { event.currentTarget.setPointerCapture(event.pointerId); }
        catch { cancel(event.pointerId); }
      }}
      onPointerMove={event => {
        const next = point(event);
        if (next && inputRef.current.move(event.pointerId, next, strokes, disabled)) redraw();
      }}
      onPointerUp={event => {
        if (inputRef.current.source() !== event.pointerId) return;
        finish(event.pointerId, point(event));
      }}
      onPointerCancel={event => cancel(event.pointerId)}
      onLostPointerCapture={event => cancel(event.pointerId)}
      onBlur={() => cancel()}>Your browser does not support the signature pad.</canvas>
    <button className="enquiry-button enquiry-button-secondary" type="button" disabled={disabled || !strokes.length} onClick={() => { cancel(); onChange([]); }}>Clear signature</button>
    <span className="enquiry-hint" role="status">{strokes.length ? " Signature captured on this page. Submit to save it." : " No signature captured yet."}</span>
  </div>;
}
