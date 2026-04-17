import { useCallback, useEffect, useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Collapse,
  Container,
  Group,
  Loader,
  Stack,
  Text,
  ThemeIcon,
  UnstyledButton,
} from "@mantine/core";
import {
  IconBox,
  IconChevronDown,
  IconChevronRight,
  IconCube,
  IconDatabase,
  IconLayoutGrid,
  IconPackage,
  IconRefresh,
  IconServer,
  IconShape,
  IconStar,
  IconTool,
} from "@tabler/icons-react";

interface BuildingBlock {
  id: string;
  name: string;
  type: string;
}

interface ModuleBranch {
  name: string;
  fullPath: string;
  modules: ModuleBranch[];
  buildingBlocks: BuildingBlock[];
}

interface BoundedContextBranch {
  name: string;
  modules: ModuleBranch[];
  buildingBlocks: BuildingBlock[];
}

interface DomainModelTree {
  boundedContexts: BoundedContextBranch[];
}

type ScanState = "idle" | "scanning" | "done" | "error";

export function ModelPage() {
  const [model, setModel] = useState<DomainModelTree | null>(null);
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [treeVersion, setTreeVersion] = useState(0);

  const loadModel = useCallback(() => {
    fetch("/api/model")
      .then((res) => res.json())
      .then((data: DomainModelTree) => {
        setModel(data);
        setTreeVersion((v) => v + 1);
        if (data.boundedContexts.length > 0) setScanState("done");
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadModel();
  }, [loadModel]);

  const handleScan = useCallback(() => {
    setScanState("scanning");
    setError(null);
    fetch("/api/model/scan", { method: "POST" })
      .then((res) => {
        if (!res.ok) throw new Error(`Scan failed (${res.status})`);
        return res.json();
      })
      .then((data: DomainModelTree) => {
        setModel(data);
        setTreeVersion((v) => v + 1);
        setScanState("done");
      })
      .catch((err: Error) => {
        setError(err.message);
        setScanState("error");
      });
  }, []);

  return (
    <Container size="lg" py="xl">
      <Stack gap="xl">
        <Group justify="space-between" align="center">
          <Text component="h1" size="xl" fw={700} c="gray.1">
            Model
          </Text>
          <Button
            leftSection={
              scanState === "scanning" ? (
                <Loader size={16} color="white" />
              ) : (
                <IconRefresh size={16} stroke={1.5} />
              )
            }
            onClick={handleScan}
            disabled={scanState === "scanning"}
            variant="light"
            color="noesisBlue"
          >
            {scanState === "scanning" ? "Scanning..." : "Scan Repository"}
          </Button>
        </Group>

        {error && (
          <Card withBorder radius="md" bg="dark.6" p="md">
            <Text size="sm" c="red.4">
              {error}
            </Text>
          </Card>
        )}

        {model !== null && model.boundedContexts.length > 0 ? (
          <ModelTreeView key={treeVersion} model={model} />
        ) : scanState === "done" ? (
          <EmptyState />
        ) : scanState === "idle" ? (
          <ScanPrompt />
        ) : null}
      </Stack>
    </Container>
  );
}

function ModelTreeView({ model }: { model: DomainModelTree }) {
  return (
    <Stack gap="sm">
      {model.boundedContexts.map((bc) => (
        <BoundedContextItem key={bc.name} bc={bc} />
      ))}
    </Stack>
  );
}

function BoundedContextItem({ bc }: { bc: BoundedContextBranch }) {
  const [opened, setOpened] = useState(true);
  const hasChildren = bc.modules.length > 0 || bc.buildingBlocks.length > 0;

  return (
    <Card withBorder radius="md" bg="dark.6" p={0}>
      <TreeNodeButton
        onClick={() => setOpened((v) => !v)}
        opened={opened}
        hasChildren={hasChildren}
        icon={
          <ThemeIcon size="sm" variant="light" color="noesisIndigo" radius="sm">
            <IconLayoutGrid size={14} stroke={1.5} />
          </ThemeIcon>
        }
        label={bc.name}
        badge={
          <Badge size="xs" variant="light" color="noesisIndigo" radius="xl">
            Bounded Context
          </Badge>
        }
        level={0}
      />
      <Collapse in={opened}>
        <Box pl="lg" pb="xs">
          {bc.modules.map((mod) => (
            <ModuleItem key={mod.fullPath} mod={mod} level={1} />
          ))}
          {bc.buildingBlocks.map((bb) => (
            <BuildingBlockItem key={bb.id} bb={bb} level={1} />
          ))}
        </Box>
      </Collapse>
    </Card>
  );
}

function ModuleItem({
  mod,
  level,
}: {
  mod: ModuleBranch;
  level: number;
}) {
  const [opened, setOpened] = useState(false);
  const hasChildren = mod.modules.length > 0 || mod.buildingBlocks.length > 0;

  return (
    <Box>
      <TreeNodeButton
        onClick={() => setOpened((v) => !v)}
        opened={opened}
        hasChildren={hasChildren}
        icon={
          <ThemeIcon size="sm" variant="light" color="noesisBlue" radius="sm">
            <IconPackage size={14} stroke={1.5} />
          </ThemeIcon>
        }
        label={mod.name}
        badge={
          <Badge size="xs" variant="light" color="noesisBlue" radius="xl">
            Module
          </Badge>
        }
        level={level}
      />
      <Collapse in={opened}>
        <Box pl="lg">
          {mod.modules.map((child) => (
            <ModuleItem key={child.fullPath} mod={child} level={level + 1} />
          ))}
          {mod.buildingBlocks.map((bb) => (
            <BuildingBlockItem key={bb.id} bb={bb} level={level + 1} />
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}

function BuildingBlockItem({
  bb,
  level,
}: {
  bb: BuildingBlock;
  level: number;
}) {
  const { icon, color } = blockTypeStyle(bb.type);

  return (
    <Group
      gap="xs"
      py={4}
      px="sm"
      pl={level * 8 + 12}
      style={{
        borderRadius: "var(--mantine-radius-sm)",
        transition: "background-color 150ms ease",
      }}
    >
      <Box w={22} />
      <ThemeIcon size="sm" variant="light" color={color} radius="sm">
        {icon}
      </ThemeIcon>
      <Text size="sm" c="gray.2" fw={400}>
        {bb.name}
      </Text>
      <Badge size="xs" variant="light" color={color} radius="xl">
        {bb.type}
      </Badge>
    </Group>
  );
}

function TreeNodeButton({
  onClick,
  opened,
  hasChildren,
  icon,
  label,
  badge,
  level,
}: {
  onClick: () => void;
  opened: boolean;
  hasChildren: boolean;
  icon: React.ReactNode;
  label: string;
  badge: React.ReactNode;
  level: number;
}) {
  return (
    <UnstyledButton
      onClick={onClick}
      w="100%"
      py={8}
      px="sm"
      pl={level * 8 + 12}
      style={{
        borderRadius: "var(--mantine-radius-sm)",
        transition: "background-color 150ms ease",
      }}
    >
      <Group gap="xs">
        {hasChildren ? (
          <ActionIcon variant="subtle" color="gray" size="xs">
            {opened ? (
              <IconChevronDown size={14} stroke={1.5} />
            ) : (
              <IconChevronRight size={14} stroke={1.5} />
            )}
          </ActionIcon>
        ) : (
          <Box w={22} />
        )}
        {icon}
        <Text size="sm" fw={600} c="gray.1">
          {label}
        </Text>
        {badge}
      </Group>
    </UnstyledButton>
  );
}

function EmptyState() {
  return (
    <Card withBorder radius="md" bg="dark.6" p="xl">
      <Stack align="center" gap="sm">
        <IconCube size={40} stroke={1} color="var(--mantine-color-gray-5)" />
        <Text size="sm" c="dimmed">
          No building blocks found. Make sure the repository has DDD annotations.
        </Text>
      </Stack>
    </Card>
  );
}

function ScanPrompt() {
  return (
    <Card withBorder radius="md" bg="dark.6" p="xl">
      <Stack align="center" gap="sm">
        <IconCube size={40} stroke={1} color="var(--mantine-color-gray-5)" />
        <Text size="sm" c="dimmed">
          Scan the repository to discover bounded contexts, modules, and building blocks.
        </Text>
      </Stack>
    </Card>
  );
}

function blockTypeStyle(type: string): {
  icon: React.ReactNode;
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
