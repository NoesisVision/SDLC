import { useEffect, useState } from "react";
import {
  Badge,
  Card,
  Container,
  Group,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import {
  IconMessageCircle,
  IconGavel,
  IconCube,
  IconFileDescription,
  IconSchema,
  IconMessages,
} from "@tabler/icons-react";
import { ActionsGrid, type ActionItem } from "../actions-grid.js";
import classes from "../actions-grid.module.css";

interface HealthStatus {
  status: string;
}

interface SerenaStatus {
  status: "disconnected" | "connecting" | "connected" | "error";
  error?: string;
  tools?: string[];
}

export function HomePage({ onNavigate }: { onNavigate: (path: string) => void }) {
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

  const actionItems: ActionItem[] = [
    { title: "Conversations", icon: IconMessages, color: "noesisBlue", onClick: () => onNavigate("/conversations") },
    { title: "Topics", icon: IconMessageCircle, color: "noesisGreen", onClick: () => onNavigate("/topics") },
    { title: "Decisions", icon: IconGavel, color: "noesisIndigo", onClick: () => onNavigate("/decisions") },
    { title: "Design Docs", icon: IconFileDescription, color: "noesisIndigo", onClick: () => onNavigate("/design-docs") },
    { title: "Model Explorer", icon: IconCube, color: "noesisBlue", onClick: () => onNavigate("/model-explorer") },
    { title: "Schema Explorer", icon: IconSchema, color: "noesisGreen", onClick: () => onNavigate("/schema-explorer") },
  ];

  return (
    <Container size="lg" py="xl">
      <Stack gap="xl">
        <HomeHeader />
        <ActionsGrid title="Explore" items={actionItems} cols={6} />
        <Stack gap="sm">
          <Text size="sm" c="dimmed" fw={500} tt="uppercase">
            System Status
          </Text>
          <Card withBorder radius="md" className={classes.card}>
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
          </Card>
        </Stack>
      </Stack>
    </Container>
  );
}

function HomeHeader() {
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
    <Card radius="md" padding="lg" bg="dark.6" withBorder>
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
    </Card>
  );
}

function ConnectionBadge({ status }: { status: string }) {
  switch (status) {
    case "error":
      return <Badge color="red" size="lg" variant="dot">Error</Badge>;
    case "disconnected":
      return <Badge color="gray" size="lg" variant="dot">Disconnected</Badge>;
    case "connecting":
      return <Badge color="yellow" size="lg" variant="dot">Connecting...</Badge>;
    case "connected":
      return <Badge color="green" size="lg" variant="dot">Connected</Badge>;
    default:
      return <Badge color="gray" size="lg" variant="dot">Unknown</Badge>;
  }
}
