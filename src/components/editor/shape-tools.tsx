"use client";

import { useTranslations } from "next-intl";

import { RadioButtons } from "~/components/radio-buttons";
import { iconButtonClass, Tooltip } from "~/components/tooltip";
import { BRUSH_SIZES, type BrushSize, type Tool } from "~/maze";
import { BrushIcon, ToolIcon } from "./tool-icons";

export type ShapeToolsProps = {
  tool: Tool;
  onTool: (tool: Tool) => void;
  used: number;
  budget: number;
  brush: BrushSize;
  onBrush: (brush: BrushSize) => void;
};

/** The two tools this palette offers, in display and arrow-key order. */
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
    return option === "paint" ? t("paint") : t("eraseCell");
  }
  function brushLabel(size: BrushSize): string {
    return t("brushSize", { size });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-4">
        {/* `tool` is shared with the detail palette, so it can hold a value
            neither button represents; RadioButtons keeps a tab stop anyway. */}
        <RadioButtons
          aria-label={t("shapeToolsLabel")}
          options={SHAPE_TOOLS}
          value={tool}
          onChange={onTool}
          optionLabel={toolLabel}
          renderOption={(option) => (
            <>
              <ToolIcon tool={option} />
              <Tooltip label={toolLabel(option)} />
            </>
          )}
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
          className="flex gap-2"
        />
      </div>

      <p data-budget className="text-sm">
        {t("budget", { used, budget })}
      </p>
    </div>
  );
}
