"use client";

import { AppButton } from "@/components/app-button";
import { mergeClassNames } from "@/lib/class-names";

import { useCallback, useRef, useState } from "react";
import { useDrag, useDrop } from "react-dnd";
import { Minus, Plus, Trash2 } from "lucide-react";
import { NumberInputField } from "@/components/number-input-field";
import { formatQuantity, formatVnd } from "@/lib/format";
import { DECIMAL_INPUT_STEP } from "@/lib/constants";
import { getBundleComponentQuantity } from "@/lib/product-bundles";
import type { CartLine } from "@/lib/types";

type DropEdge = "before" | "after";
const DROP_EDGE_HYSTERESIS_PX = 8;

export function PosCartLine({
  line,
  index,
  onMove,
  onQuantity,
  canEditPrice,
  onPrice,
  onRemove,
}: {
  line: CartLine;
  index: number;
  onMove: (
    sourceId: string,
    targetId: string,
    edge: "before" | "after",
  ) => void;
  onQuantity: (id: string, quantity: number) => void;
  canEditPrice: boolean;
  onPrice: (id: string, price: number) => void;
  onRemove: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const edgeRef = useRef<DropEdge | null>(null);
  const [edge, setEdge] = useState<DropEdge | null>(null);
  const [{ isDragging }, drag] = useDrag(
    () => ({
      type: "pos-cart-line",
      item: { id: line.product.id },
      collect: (monitor) => ({ isDragging: monitor.isDragging() }),
    }),
    [line.product.id],
  );
  const [{ isOver }, drop] = useDrop(
    () => ({
      accept: "pos-cart-line",
      hover: (item: { id: string }, monitor) => {
        if (!ref.current || item.id === line.product.id) {
          if (edgeRef.current !== null) {
            edgeRef.current = null;
            setEdge(null);
          }
          return;
        }
        const pointer = monitor.getClientOffset();
        if (!pointer) return;
        const bounds = ref.current.getBoundingClientRect();
        const midpoint = bounds.top + bounds.height / 2;
        const previousEdge = edgeRef.current;
        let nextEdge: DropEdge;
        if (
          previousEdge === "before" &&
          pointer.y <= midpoint + DROP_EDGE_HYSTERESIS_PX
        ) {
          nextEdge = "before";
        } else if (
          previousEdge === "after" &&
          pointer.y >= midpoint - DROP_EDGE_HYSTERESIS_PX
        ) {
          nextEdge = "after";
        } else {
          nextEdge = pointer.y < midpoint ? "before" : "after";
        }

        if (edgeRef.current !== nextEdge) {
          edgeRef.current = nextEdge;
          setEdge(nextEdge);
        }
      },
      drop: (item: { id: string }) => {
        const dropEdge = edgeRef.current;
        if (item.id !== line.product.id && dropEdge)
          onMove(item.id, line.product.id, dropEdge);
        if (dropEdge) {
          edgeRef.current = null;
          setEdge(null);
        }
      },
      collect: (monitor) => ({ isOver: monitor.isOver({ shallow: true }) }),
    }),
    [line.product.id, onMove],
  );
  const setNode = useCallback(
    (node: HTMLDivElement | null) => {
      ref.current = node;
      if (node) {
        drop(node);
        drag(node);
      }
    },
    [drag, drop],
  );
  return (
    <>
      <div
        ref={setNode}
        className={mergeClassNames(
          "card pos-line",
          isDragging && "pos-line-dragging",
          isOver && edge && !isDragging && `pos-line-drop-${edge}`,
          canEditPrice && "pos-line-price-editable",
        )}
        data-dnd-index={index}
      >
        <span className="muted">{index + 1}</span>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {line.product.name}
          </div>
          <div className="muted pos-line-product-meta">
            {line.product.sku} ·{" "}
            {line.product.kind === "combo"
              ? "Combo"
              : `Tồn ${formatQuantity(line.product.stock)} ${line.product.unit}`}
          </div>
          {line.product.kind === "combo" &&
            (line.product.bundle_items ?? []).map((item) => (
              <div className="muted pos-bundle-component" key={item.product_id}>
                {item.name}:{" "}
                {formatQuantity(
                  getBundleComponentQuantity(
                    item.quantity_per_bundle,
                    line.quantity,
                  ),
                )}{" "}
                {item.unit} · Tồn {formatQuantity(item.stock)} {item.unit}
              </div>
            ))}
        </div>
        {!canEditPrice && (
          <span className="line-price" style={{ textAlign: "right" }}>
            {formatVnd(line.price)}
          </span>
        )}
        <div className="qty-control pos-quantity">
          <AppButton
            variant="secondary"

            tabIndex={-1}
            style={{ padding: 0 }}
            aria-label="Giảm số lượng"
            onClick={() => onQuantity(line.product.id, line.quantity - 1)}
          >
            <Minus size={16} />
          </AppButton>
          <NumberInputField
            className="field"
            ariaLabel={"Số lượng " + line.product.name}
            step={DECIMAL_INPUT_STEP}
            min={0}
            value={line.quantity}
            onChange={(value) => onQuantity(line.product.id, Number(value))}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                const inputs = [
                  ...document.querySelectorAll<HTMLInputElement>(
                    ".pos-line .qty-control input",
                  ),
                ];
                inputs[index + 1]?.focus();
              }
            }}
          />
          <AppButton
            variant="secondary"

            tabIndex={-1}
            style={{ padding: 0 }}
            aria-label="Tăng số lượng"
            onClick={() => onQuantity(line.product.id, line.quantity + 1)}
          >
            <Plus size={16} />
          </AppButton>
        </div>
        <b
          className="line-subtotal pos-subtotal"
          style={{ textAlign: "right" }}
        >
          {formatVnd(line.price * line.quantity)}
        </b>
        <AppButton
          variant="danger"
          className="pos-remove"
          title="Xóa sản phẩm"
          aria-label={"Xóa " + line.product.name}
          onClick={() => onRemove(line.product.id)}
        >
          <Trash2 size={18} />
        </AppButton>
        {canEditPrice && (
          <span className="line-price pos-unit-price">
            <NumberInputField
              className="field pos-unit-price-input"
              ariaLabel={"Đơn giá " + line.product.name}
              min={0}
              step={1000}
              selectOnClick
              value={line.price}
              onChange={(value) => onPrice(line.product.id, Number(value))}
            />
          </span>
        )}
      </div>
    </>
  );
}
