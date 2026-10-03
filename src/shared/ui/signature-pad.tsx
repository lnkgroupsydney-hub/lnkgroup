"use client";

import { useEffect, useId, useRef, type KeyboardEvent, type PointerEvent } from "react";

export type SignaturePoint = { x: number; y: number };

export function SignaturePad({ strokes, onChange, disabled }: { strokes: SignaturePoint[][]; onChange: (value: SignaturePoint[][]) => void; disabled: boolean }) {
  const signatureId = useId();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef<SignaturePoint[] | null>(null);
  const cursor = useRef<SignaturePoint>({x:0.15,y:0.5});
  const pointCount = () => strokes.reduce((total,stroke) => total + stroke.length, 0) + (drawing.current?.length ?? 0);
  const redraw = () => {
    const canvas = canvasRef.current, context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0,0,canvas.width,canvas.height); context.strokeStyle = "#1d2522"; context.lineWidth = 3; context.lineCap = "round"; context.lineJoin = "round";
    for (const stroke of [...strokes, ...(drawing.current ? [drawing.current] : [])]) {
      context.beginPath(); stroke.forEach((point,index) => { if (!index) context.moveTo(point.x*canvas.width,point.y*canvas.height); else context.lineTo(point.x*canvas.width,point.y*canvas.height); }); context.stroke();
    }
  };
  useEffect(() => {
    const canvas = canvasRef.current, context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0,0,canvas.width,canvas.height); context.strokeStyle = "#1d2522"; context.lineWidth = 3; context.lineCap = "round"; context.lineJoin = "round";
    for (const stroke of strokes) { context.beginPath(); stroke.forEach((point,index) => { if (!index) context.moveTo(point.x*canvas.width,point.y*canvas.height); else context.lineTo(point.x*canvas.width,point.y*canvas.height); }); context.stroke(); }
  }, [strokes]);
  function point(event: PointerEvent<HTMLCanvasElement>): SignaturePoint {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x:Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)), y:Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height)) };
  }
  function finish() { const stroke = drawing.current; drawing.current = null; if (stroke && stroke.length > 1) onChange([...strokes,stroke]); else redraw(); }
  function keyboard(event: KeyboardEvent<HTMLCanvasElement>) {
    if (disabled || !["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"," ","Enter","Escape"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === " " || event.key === "Enter") { if (drawing.current) finish(); else if (pointCount() < 2000) drawing.current = [{...cursor.current}]; }
    else if (event.key === "Escape") { drawing.current = null; redraw(); }
    else {
      cursor.current = { x:Math.max(0,Math.min(1,cursor.current.x + (event.key === "ArrowRight" ? .015 : event.key === "ArrowLeft" ? -.015 : 0))), y:Math.max(0,Math.min(1,cursor.current.y + (event.key === "ArrowDown" ? .04 : event.key === "ArrowUp" ? -.04 : 0))) };
      if (drawing.current && pointCount() < 2000) drawing.current.push({...cursor.current});
      redraw();
    }
    const context = canvasRef.current?.getContext("2d");
    if (context) { context.fillStyle = "#236461"; context.fillRect(cursor.current.x*800-3,cursor.current.y*240-3,6,6); }
  }
  return <div className="demo-signature">
    <p id={`${signatureId}-label`}><strong>Draw your demonstration signature *</strong></p>
    <p id={`${signatureId}-help`} className="enquiry-hint">Use your mouse or finger. Keyboard: focus the pad, use arrows to position the pen, press Space to start, arrows to draw, then Enter to finish a stroke.</p>
    <canvas ref={canvasRef} width={800} height={240} tabIndex={disabled ? -1 : 0} aria-labelledby={`${signatureId}-label`} aria-describedby={`${signatureId}-help`} aria-disabled={disabled} onKeyDown={keyboard}
      onPointerDown={event => { if (disabled || !event.isPrimary || event.button !== 0 || pointCount() >= 2000) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); drawing.current = [point(event)]; }}
      onPointerMove={event => { if (disabled || !drawing.current || pointCount() >= 2000) return; drawing.current.push(point(event)); redraw(); }}
      onPointerUp={event => { if (!drawing.current) return; if (pointCount() < 2000) drawing.current.push(point(event)); finish(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => { drawing.current = null; redraw(); }}>Your browser does not support the signature pad.</canvas>
    <button className="enquiry-button enquiry-button-secondary" type="button" disabled={disabled || !strokes.length} onClick={() => { drawing.current = null; onChange([]); }}>Clear signature</button>
    <span className="enquiry-hint" role="status">{strokes.length ? " Signature captured on this page. Submit to save it." : " No signature captured yet."}</span>
  </div>;
}
