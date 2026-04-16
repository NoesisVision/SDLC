import { useState } from "react";
import "@mantine/core/styles.css";
import "@xyflow/react/dist/style.css";
import { AppShell, MantineProvider, NavLink } from "@mantine/core";
import { ReactFlowProvider } from "@xyflow/react";
import {
  IconHome,
  IconMessageCircle,
  IconGavel,
  IconCube,
  IconSchema,
} from "@tabler/icons-react";
import { theme } from "./theme.js";
import { Home } from "./home.js";
import { TopicsPage, DecisionsPage, ModelPage, GraphPage } from "./pages.js";

const NAV_ITEMS = [
  { label: "Home", icon: IconHome, path: "/" },
  { label: "Topics", icon: IconMessageCircle, path: "/topics" },
  { label: "Decisions", icon: IconGavel, path: "/decisions" },
  { label: "Model", icon: IconCube, path: "/model" },
  { label: "Graph Schema", icon: IconSchema, path: "/graph" },
];

export function App() {
  const [activePath, setActivePath] = useState("/");

  return (
    <MantineProvider theme={theme} defaultColorScheme="dark">
      <ReactFlowProvider>
        <AppShell navbar={{ width: 220, breakpoint: "sm" }} padding={0}>
          <AppShell.Navbar p="sm">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.path}
                label={item.label}
                leftSection={<item.icon size={20} stroke={1.5} />}
                active={activePath === item.path}
                onClick={() => setActivePath(item.path)}
              />
            ))}
          </AppShell.Navbar>
          <AppShell.Main>
            <PageRouter activePath={activePath} onNavigate={setActivePath} />
          </AppShell.Main>
        </AppShell>
      </ReactFlowProvider>
    </MantineProvider>
  );
}

function PageRouter({
  activePath,
  onNavigate,
}: {
  activePath: string;
  onNavigate: (path: string) => void;
}) {
  switch (activePath) {
    case "/topics":
      return <TopicsPage />;
    case "/decisions":
      return <DecisionsPage />;
    case "/model":
      return <ModelPage />;
    case "/graph":
      return <GraphPage />;
    default:
      return <Home onNavigate={onNavigate} />;
  }
}
