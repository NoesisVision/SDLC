import type { ReactNode } from "react";
import {
  IconBox,
  IconCube,
  IconDatabase,
  IconLayoutGrid,
  IconServer,
  IconShape,
  IconStar,
  IconTool,
} from "@tabler/icons-react";

export interface BehaviorMeta {
  id: string;
  name: string;
  blockId: string;
  blockName: string;
  blockType: string;
}

export function blockTypeStyle(type: string): {
  icon: ReactNode;
  color: string;
} {
  switch (type) {
    case "Aggregate":
      return { icon: <IconStar size={14} stroke={1.5} />, color: "orange" };
    case "Entity":
      return { icon: <IconCube size={14} stroke={1.5} />, color: "teal" };
    case "ValueObject":
      return { icon: <IconShape size={14} stroke={1.5} />, color: "cyan" };
    case "DomainEvent":
      return { icon: <IconBox size={14} stroke={1.5} />, color: "grape" };
    case "DomainService":
      return { icon: <IconServer size={14} stroke={1.5} />, color: "violet" };
    case "ApplicationService":
      return { icon: <IconTool size={14} stroke={1.5} />, color: "blue" };
    case "Repository":
      return { icon: <IconDatabase size={14} stroke={1.5} />, color: "green" };
    case "Factory":
      return { icon: <IconTool size={14} stroke={1.5} />, color: "lime" };
    case "BoundedContext":
      return {
        icon: <IconLayoutGrid size={14} stroke={1.5} />,
        color: "noesisIndigo",
      };
    default:
      return { icon: <IconCube size={14} stroke={1.5} />, color: "gray" };
  }
}
