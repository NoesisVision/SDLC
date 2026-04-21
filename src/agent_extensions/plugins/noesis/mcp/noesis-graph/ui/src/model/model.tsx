import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Collapse,
  Group,
  Loader,
  Stack,
  Text,
  ThemeIcon,
  UnstyledButton,
} from "@mantine/core";
import {
  IconArrowLeft,
  IconBolt,
  IconChevronDown,
  IconChevronRight,
  IconCube,
  IconLayoutGrid,
  IconPackage,
  IconRefresh,
} from "@tabler/icons-react";
import { blockTypeStyle, type BehaviorMeta } from "./block-type.js";
import { InvocationFlow } from "./invocation-flow.js";
import classes from "./model.module.css";

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

type View =
  | { kind: "boundedContext"; name: string }
  | { kind: "module"; name: string; fullPath: string }
  | { kind: "buildingBlock"; buildingBlock: BuildingBlock }
  | { kind: "behavior"; buildingBlock: BuildingBlock; behaviorId: string };

type ScanState = "idle" | "scanning" | "done" | "error";

type BuildingBlockView = Extract<View, { kind: "buildingBlock" }>;

interface NavState {
  current: View | null;
  bbStack: BuildingBlockView[];
}

export function ModelPage() {
  const [model, setModel] = useState<DomainModelTree | null>(null);
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [treeVersion, setTreeVersion] = useState(0);
  const [nav, setNav] = useState<NavState>({ current: null, bbStack: [] });

  const current = nav.current;
  const canGoBack =
    current !== null &&
    (current.kind === "behavior" ||
      (current.kind === "buildingBlock" && nav.bbStack.length > 0));

  const pushView = useCallback((view: View) => {
    setNav((prev) => {
      if (prev.current !== null && isSameView(prev.current, view)) return prev;

      if (view.kind === "boundedContext" || view.kind === "module") {
        return { current: view, bbStack: [] };
      }

      if (view.kind === "behavior") {
        return { current: view, bbStack: prev.bbStack };
      }

      const prevBB = currentBuildingBlock(prev.current);
      if (
        prevBB !== null &&
        prevBB.buildingBlock.id !== view.buildingBlock.id
      ) {
        return { current: view, bbStack: [...prev.bbStack, prevBB] };
      }
      return { current: view, bbStack: prev.bbStack };
    });
  }, []);

  const goBack = useCallback(() => {
    setNav((prev) => {
      if (prev.current === null) return prev;

      if (prev.current.kind === "behavior") {
        return {
          current: {
            kind: "buildingBlock",
            buildingBlock: prev.current.buildingBlock,
          },
          bbStack: prev.bbStack,
        };
      }

      if (prev.current.kind === "buildingBlock") {
        if (prev.bbStack.length === 0) return prev;
        const next = prev.bbStack[prev.bbStack.length - 1];
        return { current: next, bbStack: prev.bbStack.slice(0, -1) };
      }

      return prev;
    });
  }, []);

  const behaviorIndex = useMemo(
    () => (model !== null ? buildBehaviorIndex(model) : new Map<string, BehaviorMeta>()),
    [model],
  );

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
        setNav({ current: null, bbStack: [] });
      })
      .catch((err: Error) => {
        setError(err.message);
        setScanState("error");
      });
  }, []);

  const hasModel = model !== null && model.boundedContexts.length > 0;

  return (
    <Box className={classes.page}>
      <Box className={classes.topBar}>
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
      </Box>

      {error && (
        <Box className={classes.errorBar}>
          <Text size="sm" c="red.4">
            {error}
          </Text>
        </Box>
      )}

      {hasModel ? (
        <Box className={classes.workspace}>
          <Box className={classes.treeColumn}>
            <Box className={classes.columnHeader}>
              <Text
                size="xs"
                fw={700}
                c="dimmed"
                style={{ letterSpacing: "0.22em", textTransform: "uppercase" }}
              >
                Elements
              </Text>
            </Box>
            <Box className={classes.scrollArea}>
              <ModelTreeView
                key={treeVersion}
                model={model}
                current={current}
                onSelect={pushView}
              />
            </Box>
          </Box>

          <Box className={classes.detailsColumn}>
            <DetailsPanel
              current={current}
              canGoBack={canGoBack}
              onBack={goBack}
              onNavigate={pushView}
              behaviorIndex={behaviorIndex}
            />
          </Box>
        </Box>
      ) : scanState === "done" ? (
        <EmptyState />
      ) : scanState === "idle" ? (
        <ScanPrompt />
      ) : null}
    </Box>
  );
}

function currentBuildingBlock(view: View | null): BuildingBlockView | null {
  if (view === null) return null;
  if (view.kind === "buildingBlock") return view;
  if (view.kind === "behavior") {
    return { kind: "buildingBlock", buildingBlock: view.buildingBlock };
  }
  return null;
}

function isSameView(a: View, b: View): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "boundedContext" && b.kind === "boundedContext")
    return a.name === b.name;
  if (a.kind === "module" && b.kind === "module")
    return a.fullPath === b.fullPath;
  if (a.kind === "buildingBlock" && b.kind === "buildingBlock")
    return a.buildingBlock.id === b.buildingBlock.id;
  if (a.kind === "behavior" && b.kind === "behavior")
    return (
      a.behaviorId === b.behaviorId &&
      a.buildingBlock.id === b.buildingBlock.id
    );
  return false;
}

function ModelTreeView({
  model,
  current,
  onSelect,
}: {
  model: DomainModelTree;
  current: View | null;
  onSelect: (v: View) => void;
}) {
  return (
    <Stack gap="sm">
      {model.boundedContexts.map((bc) => (
        <BoundedContextItem
          key={bc.name}
          bc={bc}
          current={current}
          onSelect={onSelect}
        />
      ))}
    </Stack>
  );
}

function BoundedContextItem({
  bc,
  current,
  onSelect,
}: {
  bc: BoundedContextBranch;
  current: View | null;
  onSelect: (v: View) => void;
}) {
  const [opened, setOpened] = useState(true);
  const hasChildren = bc.modules.length > 0 || bc.buildingBlocks.length > 0;
  const active =
    current?.kind === "boundedContext" && current.name === bc.name;

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
            BC
          </Badge>
        }
        level={0}
      />
      <Collapse in={opened}>
        <Box pl="md" pb="xs">
          {bc.modules.map((mod) => (
            <ModuleItem
              key={mod.fullPath}
              mod={mod}
              level={1}
              current={current}
              onSelect={onSelect}
            />
          ))}
          {bc.buildingBlocks.map((bb) => (
            <BuildingBlockItem
              key={bb.id}
              bb={bb}
              level={1}
              current={current}
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
  current,
  onSelect,
}: {
  mod: ModuleBranch;
  level: number;
  current: View | null;
  onSelect: (v: View) => void;
}) {
  const [opened, setOpened] = useState(false);
  const hasChildren = mod.modules.length > 0 || mod.buildingBlocks.length > 0;
  const active =
    current?.kind === "module" && current.fullPath === mod.fullPath;

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
        badge={null}
        level={level}
      />
      <Collapse in={opened}>
        <Box pl="md">
          {mod.modules.map((child) => (
            <ModuleItem
              key={child.fullPath}
              mod={child}
              level={level + 1}
              current={current}
              onSelect={onSelect}
            />
          ))}
          {mod.buildingBlocks.map((bb) => (
            <BuildingBlockItem
              key={bb.id}
              bb={bb}
              level={level + 1}
              current={current}
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
  current,
  onSelect,
}: {
  bb: BuildingBlock;
  level: number;
  current: View | null;
  onSelect: (v: View) => void;
}) {
  const { icon, color } = blockTypeStyle(bb.type);
  const active =
    (current?.kind === "buildingBlock" && current.buildingBlock.id === bb.id) ||
    (current?.kind === "behavior" && current.buildingBlock.id === bb.id);

  return (
    <UnstyledButton
      onClick={() => onSelect({ kind: "buildingBlock", buildingBlock: bb })}
      w="100%"
      py={4}
      px="xs"
      pl={level * 8 + 8}
      style={(theme) => ({
        borderRadius: theme.radius.sm,
        backgroundColor: active ? "rgba(79, 141, 226, 0.12)" : "transparent",
        transition: "background-color 150ms ease",
      })}
    >
      <Group gap={6} wrap="nowrap">
        <Box w={16} />
        <ThemeIcon size="sm" variant="light" color={color} radius="sm">
          {icon}
        </ThemeIcon>
        <Text size="sm" c="gray.2" fw={active ? 600 : 400} lineClamp={1} style={{ flex: 1 }}>
          {bb.name}
        </Text>
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
      py={6}
      px="xs"
      pl={level * 8 + 8}
      style={(theme) => ({
        borderRadius: theme.radius.sm,
        backgroundColor: active ? "rgba(79, 141, 226, 0.12)" : "transparent",
        transition: "background-color 150ms ease",
      })}
    >
      <Group gap={6} wrap="nowrap">
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
          <Box w={16} />
        )}
        {icon}
        <Text size="sm" fw={600} c="gray.1" lineClamp={1} style={{ flex: 1 }}>
          {label}
        </Text>
        {badge}
      </Group>
    </UnstyledButton>
  );
}

function DetailsPanel({
  current,
  canGoBack,
  onBack,
  onNavigate,
  behaviorIndex,
}: {
  current: View | null;
  canGoBack: boolean;
  onBack: () => void;
  onNavigate: (v: View) => void;
  behaviorIndex: Map<string, BehaviorMeta>;
}) {
  if (current === null) {
    return (
      <Box className={classes.detailsEmpty}>
        <Text size="sm" c="dimmed">
          Select an item on the left to see details.
        </Text>
      </Box>
    );
  }

  return (
    <Box className={classes.detailsShell}>
      <Box className={classes.detailsHeader}>
        <BackButton canGoBack={canGoBack} onBack={onBack} />
      </Box>
      <Box
        className={
          current.kind === "behavior"
            ? `${classes.detailsBody} ${classes.detailsBodyFlow}`
            : classes.detailsBody
        }
      >
        {current.kind === "boundedContext" && (
          <PlaceholderDetails
            title={current.name}
            subtitle="Bounded Context"
            color="noesisIndigo"
            icon={<IconLayoutGrid size={18} stroke={1.5} />}
          />
        )}
        {current.kind === "module" && (
          <PlaceholderDetails
            title={current.name}
            subtitle={`Module · ${current.fullPath}`}
            color="noesisBlue"
            icon={<IconPackage size={18} stroke={1.5} />}
          />
        )}
        {current.kind === "buildingBlock" && (
          <BuildingBlockDetails
            buildingBlock={current.buildingBlock}
            onSelectBehavior={(behaviorId) =>
              onNavigate({
                kind: "behavior",
                buildingBlock: current.buildingBlock,
                behaviorId,
              })
            }
          />
        )}
        {current.kind === "behavior" && (
          <BehaviorDetails
            view={current}
            behaviorIndex={behaviorIndex}
          />
        )}
      </Box>
    </Box>
  );
}

function BackButton({
  canGoBack,
  onBack,
}: {
  canGoBack: boolean;
  onBack: () => void;
}) {
  return (
    <UnstyledButton
      onClick={onBack}
      disabled={!canGoBack}
      className={classes.backButton}
      data-disabled={!canGoBack}
    >
      <IconArrowLeft size={14} stroke={1.75} />
      <span>Back</span>
    </UnstyledButton>
  );
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
    <Box p="lg">
      <Group gap="sm" align="center">
        <ThemeIcon size="lg" variant="light" color={color} radius="sm">
          {icon}
        </ThemeIcon>
        <Stack gap={2}>
          <Text size="xl" fw={700} c="gray.1">
            {title}
          </Text>
          <Text size="xs" c="dimmed">
            {subtitle}
          </Text>
        </Stack>
      </Group>
      <Text size="sm" c="dimmed" mt="lg">
        Details coming soon.
      </Text>
    </Box>
  );
}

function BuildingBlockDetails({
  buildingBlock,
  onSelectBehavior,
}: {
  buildingBlock: BuildingBlock;
  onSelectBehavior: (behaviorId: string) => void;
}) {
  const { icon, color } = blockTypeStyle(buildingBlock.type);

  return (
    <Box p="lg">
      <Stack gap="md">
        <Group gap="sm" align="center">
          <ThemeIcon size="lg" variant="light" color={color} radius="sm">
            {icon}
          </ThemeIcon>
          <Stack gap={2}>
            <Text size="xl" fw={700} c="gray.1">
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
          <Group gap={8} align="center" justify="space-between">
            <Text size="sm" fw={600} c="gray.2">
              Behaviors
            </Text>
            {buildingBlock.behaviors.length > 0 && (
              <Text size="xs" c="dimmed">
                Click to open a behavior
              </Text>
            )}
          </Group>
          {buildingBlock.behaviors.length === 0 ? (
            <Text size="sm" c="dimmed">
              No behaviors discovered.
            </Text>
          ) : (
            <Stack gap={4}>
              {buildingBlock.behaviors.map((behavior) => (
                <BehaviorRow
                  key={behavior.id}
                  behavior={behavior}
                  onSelect={() => onSelectBehavior(behavior.id)}
                />
              ))}
            </Stack>
          )}
        </Stack>
      </Stack>
    </Box>
  );
}

function BehaviorRow({
  behavior,
  onSelect,
}: {
  behavior: Behavior;
  onSelect: () => void;
}) {
  return (
    <UnstyledButton
      onClick={onSelect}
      py={8}
      px="sm"
      w="100%"
      className={classes.behaviorRow}
    >
      <Group gap="xs" justify="space-between" wrap="nowrap">
        <Group gap="xs" wrap="nowrap">
          <ThemeIcon size="sm" variant="light" color="yellow" radius="sm">
            <IconBolt size={14} stroke={1.5} />
          </ThemeIcon>
          <Text size="sm" c="gray.2">
            {behavior.name}
          </Text>
        </Group>
        <IconChevronRight
          size={14}
          stroke={1.5}
          color="var(--mantine-color-dark-2)"
        />
      </Group>
    </UnstyledButton>
  );
}

function BehaviorDetails({
  view,
  behaviorIndex,
}: {
  view: Extract<View, { kind: "behavior" }>;
  behaviorIndex: Map<string, BehaviorMeta>;
}) {
  const focus = behaviorIndex.get(view.behaviorId) ?? {
    id: view.behaviorId,
    name: view.behaviorId,
    blockId: view.buildingBlock.id,
    blockName: view.buildingBlock.name,
    blockType: view.buildingBlock.type,
  };
  const { icon, color } = blockTypeStyle(focus.blockType);

  return (
    <Box className={classes.behaviorDetails}>
      <Box className={classes.behaviorHeader}>
        <Group gap="sm" align="center" wrap="nowrap">
          <ThemeIcon size="lg" variant="light" color="yellow" radius="sm">
            <IconBolt size={18} stroke={1.5} />
          </ThemeIcon>
          <Stack gap={2} style={{ minWidth: 0 }}>
            <Text size="xl" fw={700} c="gray.1" lineClamp={1}>
              {focus.name}
            </Text>
            <Group gap={6} align="center">
              <ThemeIcon size={14} variant="light" color={color} radius="sm">
                {icon}
              </ThemeIcon>
              <Text size="xs" c="dimmed">
                {focus.blockType}
              </Text>
              <Text size="xs" c="dimmed">
                ·
              </Text>
              <Text size="xs" c="dark.1">
                {focus.blockName}
              </Text>
            </Group>
          </Stack>
        </Group>
      </Box>
      <Box className={classes.behaviorFlow}>
        <InvocationFlow focus={focus} behaviorIndex={behaviorIndex} />
      </Box>
    </Box>
  );
}

function EmptyState() {
  return (
    <Card withBorder radius="md" bg="dark.6" p="xl" m="lg">
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
    <Card withBorder radius="md" bg="dark.6" p="xl" m="lg">
      <Stack align="center" gap="sm">
        <IconCube size={40} stroke={1} color="var(--mantine-color-gray-5)" />
        <Text size="sm" c="dimmed">
          Scan the repository to discover bounded contexts, modules, and building blocks.
        </Text>
      </Stack>
    </Card>
  );
}

function buildBehaviorIndex(tree: DomainModelTree): Map<string, BehaviorMeta> {
  const index = new Map<string, BehaviorMeta>();

  const visitBlocks = (blocks: BuildingBlock[]) => {
    for (const block of blocks) {
      for (const behavior of block.behaviors) {
        index.set(behavior.id, {
          id: behavior.id,
          name: behavior.name,
          blockId: block.id,
          blockName: block.name,
          blockType: block.type,
        });
      }
    }
  };

  const visitModules = (modules: ModuleBranch[]) => {
    for (const mod of modules) {
      visitBlocks(mod.buildingBlocks);
      visitModules(mod.modules);
    }
  };

  for (const bc of tree.boundedContexts) {
    visitBlocks(bc.buildingBlocks);
    visitModules(bc.modules);
  }

  return index;
}
