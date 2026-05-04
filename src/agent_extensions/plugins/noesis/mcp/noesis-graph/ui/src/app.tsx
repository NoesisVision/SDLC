import { useCallback, useEffect, useState } from "react";
import "@mantine/core/styles.css";
import "@xyflow/react/dist/style.css";
import {
  ActionIcon,
  AppShell,
  MantineProvider,
  Stack,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { ReactFlowProvider } from "@xyflow/react";
import {
  IconHome,
  IconMessageCircle,
  IconGavel,
  IconCube,
  IconFileDescription,
  IconSchema,
  IconChevronsRight,
  IconChevronsLeft,
  IconMessages,
} from "@tabler/icons-react";
import { theme } from "./theme.js";
import { AppHeader } from "./app-header.js";
import { HomePage } from "./home/home.js";
import { TopicsPage } from "./topics/topics.js";
import { DecisionsPage } from "./decisions/decisions.js";
import { ConversationsPage } from "./conversations/conversations.js";
import { DesignDocsPage } from "./design-docs/design-docs.js";
import { ModelExplorerPage } from "./model-explorer/model-explorer.js";
import { SchemaExplorerPage } from "./schema-explorer/schema-explorer.js";

const NAV_ITEMS = [
  { label: "Home", icon: IconHome, path: "/" },
  { label: "Conversations", icon: IconMessages, path: "/conversations" },
  { label: "Topics", icon: IconMessageCircle, path: "/topics" },
  { label: "Decisions", icon: IconGavel, path: "/decisions" },
  { label: "Design Docs", icon: IconFileDescription, path: "/design-docs" },
  { label: "Model Explorer", icon: IconCube, path: "/model-explorer" },
  { label: "Schema Explorer", icon: IconSchema, path: "/schema-explorer" },
];

const NAVBAR_WIDTH_COLLAPSED = 60;
const NAVBAR_WIDTH_EXPANDED = 220;
const HEADER_HEIGHT = 50;

interface HistoryState {
  selectionId: string | null;
}

export interface CrossNav {
  initialSelectionId: string | null;
  pushTo: (
    targetPath: string,
    targetId: string,
    sourceId: string | null,
  ) => void;
}

function readHistorySelection(): string | null {
  const state = window.history.state as HistoryState | null;
  return state?.selectionId ?? null;
}

export function App() {
  const [activePath, setActivePath] = useState(window.location.pathname);
  const [pendingSelection, setPendingSelection] = useState<string | null>(
    readHistorySelection,
  );
  const [navExpanded, setNavExpanded] = useState(false);

  useEffect(() => {
    const handlePopState = () => {
      setPendingSelection(readHistorySelection());
      setActivePath(window.location.pathname);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigate = useCallback((path: string) => {
    if (path !== window.location.pathname) {
      window.history.pushState({ selectionId: null }, "", path);
    } else {
      window.history.replaceState({ selectionId: null }, "", path);
    }
    setPendingSelection(null);
    setActivePath(path);
  }, []);

  const pushTo = useCallback(
    (targetPath: string, targetId: string, sourceId: string | null) => {
      window.history.replaceState(
        { selectionId: sourceId },
        "",
        window.location.pathname,
      );
      window.history.pushState({ selectionId: targetId }, "", targetPath);
      setPendingSelection(targetId);
      setActivePath(targetPath);
    },
    [],
  );

  const crossNav: CrossNav = {
    initialSelectionId: pendingSelection,
    pushTo,
  };

  const navbarWidth = navExpanded ? NAVBAR_WIDTH_EXPANDED : NAVBAR_WIDTH_COLLAPSED;

  return (
    <MantineProvider theme={theme} defaultColorScheme="dark">
      <ReactFlowProvider>
        <AppShell
          header={{ height: HEADER_HEIGHT }}
          navbar={{ width: navbarWidth, breakpoint: "sm" }}
          padding={0}
        >
          <AppShell.Header>
            <AppHeader />
          </AppShell.Header>
          <AppShell.Navbar p="xs">
            <Stack gap={4} flex={1}>
              {NAV_ITEMS.map((item) => (
                <NavButton
                  key={item.path}
                  label={item.label}
                  icon={<item.icon size={20} stroke={1.5} />}
                  active={activePath === item.path}
                  expanded={navExpanded}
                  onClick={() => navigate(item.path)}
                />
              ))}
            </Stack>
            <ActionIcon
              variant="subtle"
              color="gray"
              size="lg"
              onClick={() => setNavExpanded((v) => !v)}
              style={{ alignSelf: navExpanded ? "flex-end" : "center" }}
            >
              {navExpanded
                ? <IconChevronsLeft size={18} stroke={1.5} />
                : <IconChevronsRight size={18} stroke={1.5} />}
            </ActionIcon>
          </AppShell.Navbar>
          <AppShell.Main>
            <PageRouter
              activePath={activePath}
              onNavigate={navigate}
              crossNav={crossNav}
            />
          </AppShell.Main>
        </AppShell>
      </ReactFlowProvider>
    </MantineProvider>
  );
}

function NavButton({
  label,
  icon,
  active,
  expanded,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  expanded: boolean;
  onClick: () => void;
}) {
  const button = (
    <UnstyledButton
      onClick={onClick}
      py={8}
      px={expanded ? 12 : 0}
      style={(theme) => ({
        display: "flex",
        alignItems: "center",
        gap: 12,
        justifyContent: expanded ? "flex-start" : "center",
        borderRadius: theme.radius.sm,
        fontWeight: active ? 600 : 400,
        fontSize: theme.fontSizes.sm,
        color: active
          ? theme.colors.noesisBlue[4]
          : theme.colors.dark[1],
        backgroundColor: active
          ? "rgba(79, 141, 226, 0.1)"
          : "transparent",
        transition: "background-color 150ms ease",
        "&:hover": {
          backgroundColor: "rgba(255,255,255,0.05)",
        },
      })}
    >
      {icon}
      {expanded && label}
    </UnstyledButton>
  );

  if (expanded) return button;

  return (
    <Tooltip label={label} position="right" withArrow>
      {button}
    </Tooltip>
  );
}

function PageRouter({
  activePath,
  onNavigate,
  crossNav,
}: {
  activePath: string;
  onNavigate: (path: string) => void;
  crossNav: CrossNav;
}) {
  switch (activePath) {
    case "/conversations":
      return <ConversationsPage crossNav={crossNav} />;
    case "/topics":
      return <TopicsPage crossNav={crossNav} />;
    case "/decisions":
      return <DecisionsPage crossNav={crossNav} />;
    case "/design-docs":
      return <DesignDocsPage />;
    case "/model-explorer":
      return <ModelExplorerPage />;
    case "/schema-explorer":
      return <SchemaExplorerPage />;
    default:
      return <HomePage onNavigate={onNavigate} />;
  }
}
