import * as CollapsiblePrimitive from "@ui-sdk/react/collapsible";
import { ChevronDown } from "lucide-react";
import * as React from "react";

interface PlayerDockProps {
  isCollapsed: boolean;
  onCollapsedChange: (isCollapsed: boolean) => void;
  children: React.ReactNode;
}

export function PlayerDock({
  isCollapsed,
  onCollapsedChange,
  children,
}: PlayerDockProps) {
  return (
    <CollapsiblePrimitive.Collapsible
      className="player-dock"
      open={!isCollapsed}
      onOpenChange={(open) => onCollapsedChange(!open)}
    >
      <CollapsiblePrimitive.CollapsibleTrigger className="player-dock-bar">
        Player view
        <ChevronDown size={14} aria-hidden="true" />
      </CollapsiblePrimitive.CollapsibleTrigger>
      <CollapsiblePrimitive.CollapsiblePanel className="scene-frame">
        {children}
      </CollapsiblePrimitive.CollapsiblePanel>
    </CollapsiblePrimitive.Collapsible>
  );
}
