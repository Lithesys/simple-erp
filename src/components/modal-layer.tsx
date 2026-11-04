"use client";

import {
  useCallback,
  forwardRef,
  useEffect,
  useRef,
  type ComponentPropsWithoutRef,
} from "react";
import { createPortal } from "react-dom";

type ActiveModalLayer = {
  token: symbol;
  element: HTMLDivElement;
  onEscape: () => void;
};

const activeLayers: ActiveModalLayer[] = [];

function closeTopModalOnEscape(event: KeyboardEvent) {
  if (event.key !== "Escape" || !activeLayers.length) return;
  const topLayer = activeLayers[activeLayers.length - 1];
  event.preventDefault();
  event.stopImmediatePropagation();
  topLayer.onEscape();
}

function syncModalLayerOrder() {
  activeLayers.forEach(({ element }, index) => {
    const order = index + 1;
    element.dataset.modalLayer = String(order);
    element.style.zIndex = `calc(var(--z-modal) + ${order})`;
  });
}

function useModalLayer(open: boolean, onEscape?: () => void) {
  const token = useRef(Symbol("modal-layer"));
  const elementRef = useRef<HTMLDivElement>(null);
  const onEscapeRef = useRef(onEscape);

  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    const element = elementRef.current;
    if (!open || !element) return;

    const layerToken = token.current;
    activeLayers.push({
      token: layerToken,
      element,
      onEscape: () => onEscapeRef.current?.(),
    });
    if (activeLayers.length === 1)
      window.addEventListener("keydown", closeTopModalOnEscape, true);
    syncModalLayerOrder();

    return () => {
      const activeIndex = activeLayers.findIndex(
        (layer) => layer.token === layerToken,
      );
      if (activeIndex !== -1) activeLayers.splice(activeIndex, 1);
      if (!activeLayers.length)
        window.removeEventListener("keydown", closeTopModalOnEscape, true);
      element.style.removeProperty("z-index");
      element.removeAttribute("data-modal-layer");
      syncModalLayerOrder();
    };
  }, [open]);

  return elementRef;
}

type ModalLayerProps = ComponentPropsWithoutRef<"div"> & {
  open?: boolean;
  onEscape?: () => void;
};

export const ModalLayer = forwardRef<HTMLDivElement, ModalLayerProps>(
  function ModalLayer(
    { open = true, onEscape, className, style, ...props },
    ref,
  ) {
    const elementRef = useModalLayer(open, onEscape);
    const setElementRef = useCallback(
      (element: HTMLDivElement | null) => {
        elementRef.current = element;
        if (typeof ref === "function") ref(element);
        else if (ref) ref.current = element;
      },
      [elementRef, ref],
    );
    if (!open || typeof document === "undefined") return null;

    return createPortal(
      <div
        {...props}
        ref={setElementRef}
        className={`modal-layer${className ? ` ${className}` : ""}`}
        style={style}
      />,
      document.body,
    );
  },
);
