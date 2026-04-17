import { useCallback, useEffect, useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Collapse,
  Container,
  Grid,
  Group,
  Loader,
  Stack,
  Text,
  ThemeIcon,
  UnstyledButton,
} from "@mantine/core";
import {
  IconBolt,
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

interface Behavior {
  id: string;
  name: string;
}

interface BuildingBlock {
  id: string;
  name: string;
  type: string;
  behaviors: Behavior[];
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

type Selection =
  | { kind: "boundedContext"; name: string }
  | { kind: "module"; name: string; fullPath: string }
  | { kind: "buildingBlock"; buildingBlock: BuildingBlock };

type ScanState = "idle" | "scanning" | "done" | "error";

export function ModelPage() {
  const [model, setModel] = useState<DomainModelTree | null>(null);
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [treeVersion, setTreeVersion] = useState(0);
  const [selection, setSelection] = useState<Selection | null>(null);

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
        setSelection(null);
      })
      .catch((err: Error) => {
        setError(err.message);
        setScanState("error");
      });
  }, []);

  return (
    <Container size="xl" py="xl">
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
          <Grid gutter="lg" align="flex-start">
            <Grid.Col span={{ base: 12, md: 6 }}>
              <ModelTreeView
                key={treeVersion}
                model={model}
                selection={selection}
                onSelect={setSelection}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 6 }}>
              <DetailsPanel selection={selection} />
            </Grid.Col>
          </Grid>
        ) : scanState === "done" ? (
          <EmptyState />
        ) : scanState === "idle" ? (
          <ScanPrompt />
        ) : null}
      </Stack>
    </Container>
  );
}

function ModelTreeView({
  model,
  selection,
  onSelect,
}: {
  model: DomainModelTree;
  selection: Selection | null;
  onSelect: (s: Selection) => void;
}) {
  return (
    <Stack gap="sm">
      {model.boundedContexts.map((bc) => (
        <BoundedContextItem
          key={bc.name}
          bc={bc}
          selection={selection}
          onSelect={onSelect}
        />
      ))}
    </Stack>
  );
}

function BoundedContextItem({
  bc,
  selection,
  onSelect,
}: {
  bc: BoundedContextBranch;
  selection: Selection | null;
  onSelect: (s: Selection) => void;
}) {
  const [opened, setOpened] = useState(true);
  const hasChildren = bc.modules.length > 0 || bc.buildingBlocks.length > 0;
  const active =
    selection?.kind === "boundedContext" && selection.name === bc.name;

  return (
    <Card withBorder radius="md" bg="dark.6" p={0}>
      <TreeNodeButton
        onToggle={() => setOpened((v) => !v)}
        onSelect={() => onSelect({ kind: "boundedContext", name: bc.name })}
        opened={opened}
        hasChildren={hasChildren}
        active={active}
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
            <ModuleItem
              key={mod.fullPath}
              mod={mod}
              level={1}
              selection={selection}
              onSelect={onSelect}
            />
          ))}
          {bc.buildingBlocks.map((bb) => (
            <BuildingBlockItem
              key={bb.id}
              bb={bb}
              level={1}
              selection={selection}
              onSelect={onSelect}
            />
          ))}
        </Box>
      </Collapse>
    </Card>
  );
}

function ModuleItem({
  mod,
  level,
  selection,
  onSelect,
}: {
  mod: ModuleBranch;
  level: number;
  selection: Selection | null;
  onSelect: (s: Selection) => void;
}) {
  const [opened, setOpened] = useState(false);
  const hasChildren = mod.modules.length > 0 || mod.buildingBlocks.length > 0;
  const active =
    selection?.kind === "module" && selection.fullPath === mod.fullPath;

  return (
    <Box>
      <TreeNodeButton
        onToggle={() => setOpened((v) => !v)}
        onSelect={() =>
          onSelect({ kind: "module", name: mod.name, fullPath: mod.fullPath })
        }
        opened={opened}
        hasChildren={hasChildren}
        active={active}
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
            <ModuleItem
              key={child.fullPath}
              mod={child}
              level={level + 1}
              selection={selection}
              onSelect={onSelect}
            />
          ))}
          {mod.buildingBlocks.map((bb) => (
            <BuildingBlockItem
              key={bb.id}
              bb={bb}
              level={level + 1}
              selection={selection}
              onSelect={onSelect}
            />
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}

function BuildingBlockItem({
  bb,
  level,
  selection,
  onSelect,
}: {
  bb: BuildingBlock;
  level: number;
  selection: Selection | null;
  onSelect: (s: Selection) => void;
}) {
  const { icon, color } = blockTypeStyle(bb.type);
  const active = selection?.kind === "buildingBlock" && selection.buildingBlock.id === bb.id;

  return (
    <UnstyledButton
      onClick={() => onSelect({ kind: "buildingBlock", buildingBlock: bb })}
      w="100%"
      py={4}
      px="sm"
      pl={level * 8 + 12}
      style={(theme) => ({
        borderRadius: theme.radius.sm,
        backgroundColor: active ? "rgba(79, 141, 226, 0.12)" : "transparent",
        transition: "background-color 150ms ease",
      })}
    >
      <Group gap="xs">
        <Box w={22} />
        <ThemeIcon size="sm" variant="light" color={color} radius="sm">
          {icon}
        </ThemeIcon>
        <Text size="sm" c="gray.2" fw={active ? 600 : 400}>
          {bb.name}
        </Text>
        <Badge size="xs" variant="light" color={color} radius="xl">
          {bb.type}
        </Badge>
      </Group>
    </UnstyledButton>
  );
}

function TreeNodeButton({
  onToggle,
  onSelect,
  opened,
  hasChildren,
  active,
  icon,
  label,
  badge,
  level,
}: {
  onToggle: () => void;
  onSelect: () => void;
  opened: boolean;
  hasChildren: boolean;
  active: boolean;
  icon: React.ReactNode;
  label: string;
  badge: React.ReactNode;
  level: number;
}) {
  return (
    <UnstyledButton
      onClick={onSelect}
      w="100%"
      py={8}
      px="sm"
      pl={level * 8 + 12}
      style={(theme) => ({
        borderRadius: theme.radius.sm,
        backgroundColor: active ? "rgba(79, 141, 226, 0.12)" : "transparent",
        transition: "background-color 150ms ease",
      })}
    >
      <Group gap="xs">
        {hasChildren ? (
          <ActionIcon
            variant="subtle"
            color="gray"
            size="xs"
            component="div"
            onClick={(event) => {
              event.stopPropagation();
              onToggle();
            }}
          >
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

function DetailsPanel({ selection }: { selection: Selection | null }) {
  if (selection === null) {
    return (
      <Card withBorder radius="md" bg="dark.6" p="lg">
        <Text size="sm" c="dimmed">
          Select an item on the left to see details.
        </Text>
      </Card>
    );
  }

  if (selection.kind === "boundedContext") {
    return (
      <PlaceholderDetails
        title={selection.name}
        subtitle="Bounded Context"
        color="noesisIndigo"
        icon={<IconLayoutGrid size={16} stroke={1.5} />}
      />
    );
  }

  if (selection.kind === "module") {
    return (
      <PlaceholderDetails
        title={selection.name}
        subtitle={`Module · ${selection.fullPath}`}
        color="noesisBlue"
        icon={<IconPackage size={16} stroke={1.5} />}
      />
    );
  }

  return <BuildingBlockDetails buildingBlock={selection.buildingBlock} />;
}

function PlaceholderDetails({
  title,
  subtitle,
  color,
  icon,
}: {
  title: string;
  subtitle: string;
  color: string;
  icon: React.ReactNode;
}) {
  return (
    <Card withBorder radius="md" bg="dark.6" p="lg">
      <Stack gap="md">
        <Group gap="xs">
          <ThemeIcon size="md" variant="light" color={color} radius="sm">
            {icon}
          </ThemeIcon>
          <Stack gap={0}>
            <Text size="lg" fw={700} c="gray.1">
              {title}
            </Text>
            <Text size="xs" c="dimmed">
              {subtitle}
            </Text>
          </Stack>
        </Group>
        <Text size="sm" c="dimmed">
          Details coming soon.
        </Text>
      </Stack>
    </Card>
  );
}

function BuildingBlockDetails({ buildingBlock }: { buildingBlock: BuildingBlock }) {
  const { icon, color } = blockTypeStyle(buildingBlock.type);

  return (
    <Card withBorder radius="md" bg="dark.6" p="lg">
      <Stack gap="md">
        <Group gap="xs">
          <ThemeIcon size="md" variant="light" color={color} radius="sm">
            {icon}
          </ThemeIcon>
          <Stack gap={0}>
            <Text size="lg" fw={700} c="gray.1">
              {buildingBlock.name}
            </Text>
            <Group gap={6}>
              <Badge size="xs" variant="light" color={color} radius="xl">
                {buildingBlock.type}
              </Badge>
              <Text size="xs" c="dimmed">
                Building Block
              </Text>
            </Group>
          </Stack>
        </Group>

        <Stack gap="xs">
          <Text size="sm" fw={600} c="gray.2">
            Behaviors
          </Text>
          {buildingBlock.behaviors.length === 0 ? (
            <Text size="sm" c="dimmed">
              No behaviors discovered.
            </Text>
          ) : (
            <Stack gap={4}>
              {buildingBlock.behaviors.map((behavior) => (
                <BehaviorRow key={behavior.id} behavior={behavior} />
              ))}
            </Stack>
          )}
        </Stack>
      </Stack>
    </Card>
  );
}

function BehaviorRow({ behavior }: { behavior: Behavior }) {
  return (
    <Group
      gap="xs"
      py={6}
      px="sm"
      style={(theme) => ({
        borderRadius: theme.radius.sm,
        backgroundColor: "rgba(255,255,255,0.02)",
      })}
    >
      <ThemeIcon size="sm" variant="light" color="yellow" radius="sm">
        <IconBolt size={14} stroke={1.5} />
      </ThemeIcon>
      <Text size="sm" c="gray.2">
        {behavior.name}
      </Text>
    </Group>
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
