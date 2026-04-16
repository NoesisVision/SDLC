import { useEffect, useState } from "react";
import {
  Card,
  Container,
  SimpleGrid,
  Text,
  UnstyledButton,
  Paper,
  Group,
  Badge,
  Stack,
  useMantineTheme,
} from "@mantine/core";
import {
  IconHome,
  IconMessageCircle,
  IconGavel,
  IconCube,
  IconSchema,
} from "@tabler/icons-react";
import classes from "./actions-grid.module.css";

interface HealthStatus {
  status: string;
}

interface SerenaStatus {
  status: "disconnected" | "connecting" | "connected" | "error";
  error?: string;
  tools?: string[];
}

const NAV_ITEMS = [
  { title: "Home", icon: IconHome, color: "noesisBlue", path: "/" },
  { title: "Topics", icon: IconMessageCircle, color: "noesisGreen", path: "/topics" },
  { title: "Decisions", icon: IconGavel, color: "noesisIndigo", path: "/decisions" },
  { title: "Model", icon: IconCube, color: "noesisBlue", path: "/model" },
  { title: "Graph Schema", icon: IconSchema, color: "noesisGreen", path: "/graph" },
];

export function Home({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [serena, setSerena] = useState<SerenaStatus | null>(null);
  const [serenaError, setSerenaError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then((data: HealthStatus) => setHealth(data))
      .catch((err: Error) => setHealthError(err.message));

    fetch("/api/serena/status")
      .then((res) => res.json())
      .then((data: SerenaStatus) => setSerena(data))
      .catch((err: Error) => setSerenaError(err.message));
  }, []);

  return (
    <Container size="lg" py="xl">
      <Stack gap="xl">
        <Header />
        <ActionsGrid onNavigate={onNavigate} />
        <Stack gap="md">
          <Text size="sm" c="dimmed" fw={500} tt="uppercase">
            System Status
          </Text>
          <SimpleGrid cols={2}>
            <ServiceStatusCard
              name="LadybugDB"
              status={healthError ? "error" : health ? "connected" : "connecting"}
              error={healthError ?? undefined}
            />
            <ServiceStatusCard
              name="Serena"
              status={serenaError ? "error" : serena?.status ?? "connecting"}
              error={serenaError ?? serena?.error}
              detail={serena?.tools ? `${serena.tools.length} tools` : undefined}
            />
          </SimpleGrid>
        </Stack>
      </Stack>
    </Container>
  );
}

function Header() {
  return (
    <Stack gap="xs" align="center" py="xl">
      <Text
        component="h1"
        size="3rem"
        fw={700}
        variant="gradient"
        gradient={{ from: "#4f46e5", to: "#4ade80", deg: 135 }}
      >
        Noesis
      </Text>
      <Text size="lg" c="dimmed" fw={300}>
        Knowledge Graph
      </Text>
    </Stack>
  );
}

function ActionsGrid({ onNavigate }: { onNavigate: (path: string) => void }) {
  const theme = useMantineTheme();

  const items = NAV_ITEMS.map((item) => (
    <UnstyledButton
      key={item.title}
      className={classes.item}
      onClick={() => onNavigate(item.path)}
    >
      <item.icon
        color={theme.colors[item.color]?.[5] ?? theme.colors.blue[5]}
        size={32}
        stroke={1.5}
      />
      <Text size="xs" mt={7}>
        {item.title}
      </Text>
    </UnstyledButton>
  ));

  return (
    <Card withBorder radius="md" className={classes.card}>
      <Text fw={500} size="lg">
        Explore
      </Text>
      <SimpleGrid cols={3} mt="md">
        {items}
      </SimpleGrid>
    </Card>
  );
}

function ServiceStatusCard({
  name,
  status,
  error,
  detail,
}: {
  name: string;
  status: string;
  error?: string;
  detail?: string;
}) {
  return (
    <Paper
      p="lg"
      radius="md"
      style={{
        background: "rgb(17, 24, 39)",
        border: "1px solid rgba(243, 244, 246, 0.1)",
      }}
    >
      <Group justify="space-between">
        <div>
          <Text size="lg" fw={600} c="gray.1">
            {name}
          </Text>
          {detail && (
            <Text size="xs" c="dimmed" mt={2}>
              {detail}
            </Text>
          )}
          {error && (
            <Text size="xs" c="red.4" mt={2}>
              {error}
            </Text>
          )}
        </div>
        <ConnectionBadge status={status} />
      </Group>
    </Paper>
  );
}

function ConnectionBadge({ status }: { status: string }) {
  switch (status) {
    case "error":
      return (
        <Badge color="red" size="lg" variant="dot">
          Error
        </Badge>
      );
    case "disconnected":
      return (
        <Badge color="gray" size="lg" variant="dot">
          Disconnected
        </Badge>
      );
    case "connecting":
      return (
        <Badge color="yellow" size="lg" variant="dot">
          Connecting...
        </Badge>
      );
    case "connected":
      return (
        <Badge color="green" size="lg" variant="dot">
          Connected
        </Badge>
      );
    default:
      return (
        <Badge color="gray" size="lg" variant="dot">
          Unknown
        </Badge>
      );
  }
}
