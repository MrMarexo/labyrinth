"use client";

import { useTranslations } from "next-intl";

import { RadioButtons } from "~/components/radio-buttons";
import { iconButtonClass, Tooltip } from "~/components/tooltip";
import { BRUSH_SIZES, type BrushSize, type Tool } from "~/maze";
import { BrushIcon, PALETTE_GROUP, PALETTE_ROWS, ToolIcon } from "./tool-icons";

export type ShapeToolsProps = {
  tool: Tool;
  onTool: (tool: Tool) => void;
  used: number;
  budget: number;
  brush: BrushSize;
  onBrush: (brush: BrushSize) => void;
};

/** The pan tool, on a row of its own above the brush. */
const MOVE_TOOL: readonly Tool[] = ["move"];
/** The two shape tools, in display and arrow-key order. */
const SHAPE_TOOLS: readonly Tool[] = ["paint", "erase-cell"];

export function ShapeTools({
  tool,
  onTool,
  used,
  budget,
  brush,
  onBrush,
}: ShapeToolsProps) {
  const t = useTranslations("editor");

  function toolLabel(option: Tool): string {
    if (option === "move") return t("move");
    return option === "paint" ? t("paint") : t("eraseCell");
  }
  function brushLabel(size: BrushSize): string {
    return t("brushSize", { size });
  }

  const renderTool = (option: Tool) => (
    <>
      <ToolIcon tool={option} />
      <Tooltip label={toolLabel(option)} />
    </>
  );

  // On a desktop one column, like the detail palette: move, then the brush
  // size, then what the brush does. On a phone the three groups share a row.
  return (
    <div className="space-y-3">
      <div className={PALETTE_ROWS}>
        {/* `tool` is shared with the detail palette, so each group can hold
            a value none of its buttons represents; RadioButtons keeps a tab
            stop anyway. */}
        <RadioButtons
          aria-label={t("move")}
          options={MOVE_TOOL}
          value={tool}
          onChange={onTool}
          optionLabel={toolLabel}
          renderOption={renderTool}
          buttonClass={iconButtonClass}
          className="flex gap-2"
        />
        <RadioButtons
          aria-label={t("brushLabel")}
          options={BRUSH_SIZES}
          value={brush}
          onChange={onBrush}
          optionLabel={brushLabel}
          renderOption={(size) => (
            <>
              <BrushIcon size={size} />
              <Tooltip label={brushLabel(size)} />
            </>
          )}
          buttonClass={iconButtonClass}
          className={PALETTE_GROUP}
        />
        <RadioButtons
          aria-label={t("shapeToolsLabel")}
          options={SHAPE_TOOLS}
          value={tool}
          onChange={onTool}
          optionLabel={toolLabel}
          renderOption={renderTool}
          buttonClass={iconButtonClass}
          className={PALETTE_GROUP}
        />
      </div>

      <p data-budget className="text-sm">
        {t("budget", { used, budget })}
      </p>
    </div>
  );
}
