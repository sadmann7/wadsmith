import { SelectItemIndicator } from "@ui-sdk/react/select";
import { Check } from "lucide-react";

function SelectCheck() {
  return (
    <SelectItemIndicator className="ml-auto pl-3 text-primary">
      <Check size={14} aria-hidden="true" />
    </SelectItemIndicator>
  );
}

export { SelectCheck };
