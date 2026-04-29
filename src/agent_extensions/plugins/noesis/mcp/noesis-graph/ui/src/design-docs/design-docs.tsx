import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Box,
  Card,
  Collapse,
  Group,
  Loader,
  Stack,
  Text,
  ThemeIcon,
  Title,
  UnstyledButton,
} from "@mantine/core";
import {
  IconBolt,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconCube,
  IconFileDescription,
  IconLayoutGrid,
  IconList,
  IconPackage,
  IconScale,
  IconShield,
  IconUser,
} from "@tabler/icons-react";
import type {
  ChangeStatus,
  DesignDocChangeSet,
  DesignDocDetailData,
  DesignDocListItem,
  DesignDocSourceData,
  DesignDocsPageData,
  DesignedActorData,
  DesignedBehaviourData,
  DesignedBoundedContextData,
  DesignedBuildingBlockData,
  DesignedDomainModuleData,
  DesignedQualityAttributeData,
  DesignedRuleData,
  DesignedScenarioData,
} from "../../../ui-contracts/design-docs/design-docs-data.js";
import { MarkdownContent } from "../shared/markdown-content.js";
import { InlineEdit } from "../shared/inline-edit.js";
import { SyncBadges } from "../shared/sync-badges.js";
import classes from "./design-docs.module.css";

type ElementKind =
  | "actor"
  | "qualityAttribute"
  | "boundedContext"
  | "module"
  | "buildingBlock"
  | "behavior"
  | "rule"
  | "scenario";

interface ElementPathSegment {
  kind: ElementKind;
  name: string;
}

async function patchDesignDocElement(
  designDocId: string,
  path: ElementPathSegment[],
  fields: { name?: string; description?: string },
): Promise<void> {
  const res = await fetch(
    `/api/ui/design-docs/${encodeURIComponent(designDocId)}/elements`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, fields }),
    },
  );
  if (!res.ok) throw new Error(`Failed to save (${res.status})`);
}

function treeIdMarker(kind: ElementKind): string {
  switch (kind) {
    case "actor":
      return "actor";
    case "qualityAttribute":
      return "qa";
    case "boundedContext":
      return "bc";
    case "module":
      return "module";
    case "buildingBlock":
      return "bb";
    case "behavior":
      return "behavior";
    case "rule":
      return "rule";
    case "scenario":
      return "scenario";
  }
}

function mapRenamedSelectedId(
  prev: string | null,
  path: ElementPathSegment[],
  newName: string,
): string | null {
  if (prev === null || path.length === 0) return prev;
  const last = path[path.length - 1];
  const marker = treeIdMarker(last.kind);
  const suffix = `|${marker}:${last.name}`;
  if (!prev.endsWith(suffix)) return prev;
  return prev.slice(0, -suffix.length) + `|${marker}:${newName}`;
}

type TreeNodeKind =
  | "section"
  | "actor"
  | "boundedContext"
  | "module"
  | "buildingBlock"
  | "behavior"
  | "rule"
  | "scenario"
  | "qualityAttribute";

interface TreeNode {
  id: string;
  kind: TreeNodeKind;
  label: string;
  status: ChangeStatus | null;
  payload: NodePayload | null;
  path: ElementPathSegment[];
  children: TreeNode[];
}

type NodePayload =
  | { kind: "actor"; data: DesignedActorData | null }
  | { kind: "boundedContext"; data: DesignedBoundedContextData | null }
  | { kind: "module"; data: DesignedDomainModuleData | null }
  | { kind: "buildingBlock"; data: DesignedBuildingBlockData | null }
  | { kind: "behavior"; data: DesignedBehaviourData | null }
  | { kind: "rule"; data: DesignedRuleData | null }
  | { kind: "scenario"; data: DesignedScenarioData | null }
  | { kind: "qualityAttribute"; data: DesignedQualityAttributeData | null };

export function DesignDocsPage() {
  const [list, setList] = useState<DesignDocListItem[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DesignDocDetailData | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/ui/design-docs")
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load design docs (${res.status})`);
        return res.json() as Promise<DesignDocsPageData>;
      })
      .then((d) => setList(d.docs))
      .catch((err: Error) => setListError(err.message));
  }, []);

  useEffect(() => {
    if (activeDocId === null) {
      setDetail(null);
      setSelectedNodeId(null);
      return;
    }
    let cancelled = false;
    setDetail(null);
    setDetailError(null);
    setSelectedNodeId(null);
    fetch(`/api/ui/design-docs/${encodeURIComponent(activeDocId)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load design doc (${res.status})`);
        return res.json() as Promise<DesignDocDetailData>;
      })
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err: Error) => {
        if (!cancelled) setDetailError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [activeDocId]);

  const tree = useMemo(
    () => (detail !== null ? buildTree(detail.source) : []),
    [detail],
  );

  const selectedNode = useMemo(
    () => (selectedNodeId !== null ? findNode(tree, selectedNodeId) : null),
    [tree, selectedNodeId],
  );

  const handleSelectDoc = useCallback((id: string) => {
    setActiveDocId(id);
  }, []);

  const handleEdit = useCallback(
    async (
      path: ElementPathSegment[],
      fields: { name?: string; description?: string },
    ): Promise<void> => {
      if (activeDocId === null) {
        throw new Error("No active design doc");
      }
      await patchDesignDocElement(activeDocId, path, fields);
      const refreshed = await fetch(
        `/api/ui/design-docs/${encodeURIComponent(activeDocId)}`,
      );
      if (!refreshed.ok) {
        throw new Error(`Failed to reload design doc (${refreshed.status})`);
      }
      const next = (await refreshed.json()) as DesignDocDetailData;
      setDetail(next);
      if (selectedNodeId !== null && fields.name !== undefined) {
        setSelectedNodeId((prev) => mapRenamedSelectedId(prev, path, fields.name!));
      }
    },
    [activeDocId, selectedNodeId],
  );

  return (
    <Box className={classes.page}>
      <Box className={classes.topBar}>
        <Text component="h1" size="xl" fw={700} c="gray.1">
          Design Docs
        </Text>
        <Group gap="xs">
          <StatusLegend status="added" label="Added" />
          <StatusLegend status="modified" label="Modified" />
          <StatusLegend status="removed" label="Removed" />
        </Group>
      </Box>

      {listError !== null && (
        <Box p="md">
          <Text size="sm" c="red.4">
            {listError}
          </Text>
        </Box>
      )}

      {list === null && listError === null ? (
        <LoadingRow label="Loading design docs" />
      ) : list !== null && list.length === 0 ? (
        <EmptyState />
      ) : list !== null ? (
        <Box className={classes.workspace}>
          <Box className={classes.listColumn}>
            <Box className={classes.columnHeader}>
              <Text
                size="xs"
                fw={700}
                c="dimmed"
                style={{ letterSpacing: "0.22em", textTransform: "uppercase" }}
              >
                Design Docs
              </Text>
            </Box>
            <Box className={classes.scrollArea}>
              <Stack gap={6}>
                {list.map((d) => (
                  <DocListRow
                    key={d.id}
                    item={d}
                    active={d.id === activeDocId}
                    onSelect={() => handleSelectDoc(d.id)}
                  />
                ))}
              </Stack>
            </Box>
          </Box>

          <Box className={classes.treeColumn}>
            <Box className={classes.columnHeader}>
              <Text
                size="xs"
                fw={700}
                c="dimmed"
                style={{ letterSpacing: "0.22em", textTransform: "uppercase" }}
              >
                Change Set
              </Text>
            </Box>
            <Box className={classes.scrollArea}>
              {activeDocId === null ? (
                <Text size="sm" c="dimmed" px="sm" py="xs">
                  Select a design doc on the left.
                </Text>
              ) : detailError !== null ? (
                <Text size="sm" c="red.4" px="sm" py="xs">
                  {detailError}
                </Text>
              ) : detail === null ? (
                <LoadingRow label="Loading change set" />
              ) : (
                <TreePanel
                  tree={tree}
                  selectedId={selectedNodeId}
                  onSelect={setSelectedNodeId}
                />
              )}
            </Box>
          </Box>

          <Box className={classes.detailsColumn}>
            {selectedNode === null ? (
              <Box className={classes.detailsEmpty}>
                <Text size="sm" c="dimmed">
                  {activeDocId === null
                    ? "Select a design doc, then click an element."
                    : "Click an element in the change set to see its details."}
                </Text>
              </Box>
            ) : (
              <Box className={classes.detailsShell}>
                <Box className={classes.detailsBody}>
                  <NodeDetailsView node={selectedNode} onEdit={handleEdit} />
                </Box>
              </Box>
            )}
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}

function LoadingRow({ label }: { label: string }) {
  return (
    <Box p="lg">
      <Group gap="xs">
        <Loader size={14} color="noesisBlue" />
        <Text size="sm" c="dimmed">
          {label}
        </Text>
      </Group>
    </Box>
  );
}

function EmptyState() {
  return (
    <Card withBorder radius="md" bg="dark.6" p="xl" m="lg">
      <Stack align="center" gap="sm">
        <IconFileDescription
          size={40}
          stroke={1}
          color="var(--mantine-color-gray-5)"
        />
        <Text size="sm" c="dimmed">
          No design docs yet. Save a DesignDoc via the MCP server to populate this list.
        </Text>
      </Stack>
    </Card>
  );
}

function StatusLegend({
  status,
  label,
}: {
  status: ChangeStatus;
  label: string;
}) {
  return (
    <Box className={classes.legendChip}>
      <span
        className={classes.legendDot}
        style={{ backgroundColor: statusBgColor(status) }}
      />
      {label}
    </Box>
  );
}

function DocListRow({
  item,
  active,
  onSelect,
}: {
  item: DesignDocListItem;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`${classes.listItem} ${active ? classes.listItemActive : ""}`}
    >
      <Stack gap={4}>
        <Group gap={6} justify="space-between" wrap="nowrap">
          <Text size="xs" c="dimmed">
            {item.date === "" ? "—" : item.date}
          </Text>
          <SyncBadges edited_by_user={item.edited_by_user} />
        </Group>
        <Text size="sm" fw={600} c="gray.1" lineClamp={2}>
          {item.title}
        </Text>
      </Stack>
    </button>
  );
}

function TreePanel({
  tree,
  selectedId,
  onSelect,
}: {
  tree: TreeNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (tree.length === 0) {
    return (
      <Text size="sm" c="dimmed" px="sm" py="xs">
        This design doc has no recorded changes.
      </Text>
    );
  }
  return (
    <Stack gap={2}>
      {tree.map((node) => (
        <TreeItem
          key={node.id}
          node={node}
          selectedId={selectedId}
          onSelect={onSelect}
          depth={0}
        />
      ))}
    </Stack>
  );
}

function TreeItem({
  node,
  selectedId,
  onSelect,
  depth,
}: {
  node: TreeNode;
  selectedId: string | null;
  onSelect: (id: string) => void;
  depth: number;
}) {
  const [opened, setOpened] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  const active = selectedId === node.id;
  const selectable = node.kind !== "section";

  return (
    <Box>
      <UnstyledButton
        component="div"
        className={`${classes.treeNode} ${active ? classes.treeNodeActive : ""}`}
        onClick={() => {
          if (selectable) onSelect(node.id);
        }}
        style={{ paddingLeft: depth * 12 + 6 }}
      >
        <Group gap={4} wrap="nowrap" align="center">
          {hasChildren ? (
            <UnstyledButton
              component="span"
              onClick={(event) => {
                event.stopPropagation();
                setOpened((v) => !v);
              }}
              style={{
                display: "inline-flex",
                width: 18,
                height: 18,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 4,
                color: "var(--mantine-color-dark-1)",
              }}
            >
              {opened ? (
                <IconChevronDown size={14} stroke={1.5} />
              ) : (
                <IconChevronRight size={14} stroke={1.5} />
              )}
            </UnstyledButton>
          ) : (
            <Box w={18} />
          )}
          <NodeIcon kind={node.kind} status={node.status} />
          <Text
            size="sm"
            fw={node.kind === "section" ? 700 : active ? 600 : 500}
            c={node.kind === "section" ? "gray.1" : undefined}
            className={node.status !== null ? statusClass(node.status) : undefined}
            lineClamp={1}
            style={{ flex: 1 }}
          >
            {node.label}
          </Text>
        </Group>
      </UnstyledButton>
      {hasChildren && (
        <Collapse in={opened}>
          <Stack gap={2} mt={2}>
            {node.children.map((child) => (
              <TreeItem
                key={child.id}
                node={child}
                selectedId={selectedId}
                onSelect={onSelect}
                depth={depth + 1}
              />
            ))}
          </Stack>
        </Collapse>
      )}
    </Box>
  );
}

function NodeIcon({
  kind,
  status,
}: {
  kind: TreeNodeKind;
  status: ChangeStatus | null;
}) {
  const color = status === null ? "noesisBlue" : statusMantineColor(status);
  const icon = nodeIcon(kind);
  return (
    <ThemeIcon size="sm" variant="light" color={color} radius="sm">
      {icon}
    </ThemeIcon>
  );
}

function nodeIcon(kind: TreeNodeKind): React.ReactNode {
  switch (kind) {
    case "section":
      return <IconList size={14} stroke={1.5} />;
    case "actor":
      return <IconUser size={14} stroke={1.5} />;
    case "boundedContext":
      return <IconLayoutGrid size={14} stroke={1.5} />;
    case "module":
      return <IconPackage size={14} stroke={1.5} />;
    case "buildingBlock":
      return <IconCube size={14} stroke={1.5} />;
    case "behavior":
      return <IconBolt size={14} stroke={1.5} />;
    case "rule":
      return <IconScale size={14} stroke={1.5} />;
    case "scenario":
      return <IconCheck size={14} stroke={1.5} />;
    case "qualityAttribute":
      return <IconShield size={14} stroke={1.5} />;
  }
}

type EditFn = (
  path: ElementPathSegment[],
  fields: { name?: string; description?: string },
) => Promise<void>;

function NodeDetailsView({
  node,
  onEdit,
}: {
  node: TreeNode;
  onEdit: EditFn;
}) {
  if (node.payload === null) {
    return (
      <Box p="lg">
        <Group gap="sm" align="center">
          <ThemeIcon
            size="lg"
            variant="light"
            color={node.status !== null ? statusMantineColor(node.status) : "noesisBlue"}
            radius="sm"
          >
            {nodeIcon(node.kind)}
          </ThemeIcon>
          <Stack gap={2}>
            <Title order={1} size="h3" c="gray.1" fw={700}>
              {node.label}
            </Title>
            {node.status !== null && (
              <Group gap={6}>
                <StatusBadge status={node.status} />
                <Text size="xs" c="dimmed">
                  {kindLabel(node.kind)}
                </Text>
              </Group>
            )}
          </Stack>
        </Group>
      </Box>
    );
  }

  const payload = node.payload;
  const editable = node.status !== "removed";
  switch (payload.kind) {
    case "actor":
      return (
        <ActorDetails
          data={payload.data}
          status={node.status}
          name={node.label}
          path={node.path}
          onEdit={editable ? onEdit : null}
        />
      );
    case "boundedContext":
      return (
        <BoundedContextDetails
          data={payload.data}
          status={node.status}
          name={node.label}
          path={node.path}
          onEdit={editable ? onEdit : null}
        />
      );
    case "module":
      return (
        <ModuleDetails
          data={payload.data}
          status={node.status}
          name={node.label}
          path={node.path}
          onEdit={editable ? onEdit : null}
        />
      );
    case "buildingBlock":
      return (
        <BuildingBlockDetails
          data={payload.data}
          status={node.status}
          name={node.label}
          path={node.path}
          onEdit={editable ? onEdit : null}
        />
      );
    case "behavior":
      return (
        <BehaviorDetails
          data={payload.data}
          status={node.status}
          name={node.label}
          path={node.path}
          onEdit={editable ? onEdit : null}
        />
      );
    case "rule":
      return (
        <RuleDetails
          data={payload.data}
          status={node.status}
          name={node.label}
          path={node.path}
          onEdit={editable ? onEdit : null}
        />
      );
    case "scenario":
      return (
        <ScenarioDetails
          data={payload.data}
          status={node.status}
          name={node.label}
          path={node.path}
          onEdit={editable ? onEdit : null}
        />
      );
    case "qualityAttribute":
      return (
        <QualityAttributeDetails
          data={payload.data}
          status={node.status}
          name={node.label}
          path={node.path}
          onEdit={editable ? onEdit : null}
        />
      );
  }
}

function DetailsHeader({
  kind,
  name,
  status,
  subtitle,
  path,
  onEdit,
}: {
  kind: TreeNodeKind;
  name: string;
  status: ChangeStatus | null;
  subtitle?: string;
  path?: ElementPathSegment[];
  onEdit?: EditFn | null;
}) {
  const color = status !== null ? statusMantineColor(status) : "noesisBlue";
  const titleNode = (
    <Title order={1} size="h3" c="gray.1" fw={700}>
      {name}
    </Title>
  );
  return (
    <Box className={classes.section}>
      <Group gap="sm" align="center" wrap="nowrap">
        <ThemeIcon size="lg" variant="light" color={color} radius="sm">
          {nodeIcon(kind)}
        </ThemeIcon>
        <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
          {onEdit !== undefined && onEdit !== null && path !== undefined ? (
            <InlineEdit
              value={name}
              mode="text"
              ariaLabel="Edit name"
              onSave={(next) => onEdit(path, { name: next })}
              display={titleNode}
            />
          ) : (
            titleNode
          )}
          <Group gap={6}>
            {status !== null && <StatusBadge status={status} />}
            <Text size="xs" c="dimmed">
              {kindLabel(kind)}
              {subtitle !== undefined && subtitle !== "" ? ` · ${subtitle}` : ""}
            </Text>
          </Group>
        </Stack>
      </Group>
    </Box>
  );
}

function DescriptionEditor({
  value,
  path,
  onEdit,
}: {
  value: string;
  path: ElementPathSegment[];
  onEdit: EditFn | null;
}) {
  const display =
    value === "" || value === "—" ? (
      <Text className={classes.kvValue}>{value === "" ? "—" : value}</Text>
    ) : (
      <MarkdownContent text={value} />
    );
  if (onEdit === null) return display;
  return (
    <InlineEdit
      value={value === "—" ? "" : value}
      mode="textarea"
      block
      ariaLabel="Edit description"
      onSave={(next) => onEdit(path, { description: next })}
      display={display}
    />
  );
}

interface DetailsProps<T> {
  data: T | null;
  status: ChangeStatus | null;
  name: string;
  path: ElementPathSegment[];
  onEdit: EditFn | null;
}

function DescriptionSection({
  value,
  path,
  onEdit,
}: {
  value: string | null;
  path: ElementPathSegment[];
  onEdit: EditFn | null;
}) {
  return (
    <Box className={classes.section}>
      <Box className={classes.kvRow}>
        <Text className={classes.kvKey}>Description</Text>
        <DescriptionEditor value={value ?? ""} path={path} onEdit={onEdit} />
      </Box>
    </Box>
  );
}

function ActorDetails({
  data,
  status,
  name,
  path,
  onEdit,
}: DetailsProps<DesignedActorData>) {
  return (
    <Stack gap={0}>
      <DetailsHeader
        kind="actor"
        name={data?.name ?? name}
        status={status}
        path={path}
        onEdit={onEdit}
      />
      {data !== null && (
        <DescriptionSection value={data.description} path={path} onEdit={onEdit} />
      )}
    </Stack>
  );
}

function QualityAttributeDetails({
  data,
  status,
  name,
  path,
  onEdit,
}: DetailsProps<DesignedQualityAttributeData>) {
  return (
    <Stack gap={0}>
      <DetailsHeader
        kind="qualityAttribute"
        name={data?.name ?? name}
        status={status}
        subtitle={data?.type ?? undefined}
        path={path}
        onEdit={onEdit}
      />
      {data !== null && (
        <DescriptionSection value={data.description} path={path} onEdit={onEdit} />
      )}
    </Stack>
  );
}

function BoundedContextDetails({
  data,
  status,
  name,
  path,
  onEdit,
}: DetailsProps<DesignedBoundedContextData>) {
  return (
    <Stack gap={0}>
      <DetailsHeader
        kind="boundedContext"
        name={data?.name ?? name}
        status={status}
        path={path}
        onEdit={onEdit}
      />
      {data !== null && (
        <DescriptionSection value={data.description} path={path} onEdit={onEdit} />
      )}
      {data !== null && (
        <ChangeSummary
          modules={data.modules}
          buildingBlocks={data.buildingBlocks}
        />
      )}
    </Stack>
  );
}

function ModuleDetails({
  data,
  status,
  name,
  path,
  onEdit,
}: DetailsProps<DesignedDomainModuleData>) {
  return (
    <Stack gap={0}>
      <DetailsHeader
        kind="module"
        name={data?.name ?? name}
        status={status}
        path={path}
        onEdit={onEdit}
      />
      {data !== null && (
        <DescriptionSection value={data.description} path={path} onEdit={onEdit} />
      )}
      {data !== null && <ChangeSummary buildingBlocks={data.buildingBlocks} />}
    </Stack>
  );
}

function BuildingBlockDetails({
  data,
  status,
  name,
  path,
  onEdit,
}: DetailsProps<DesignedBuildingBlockData>) {
  return (
    <Stack gap={0}>
      <DetailsHeader
        kind="buildingBlock"
        name={data?.name ?? name}
        status={status}
        subtitle={data?.type ?? undefined}
        path={path}
        onEdit={onEdit}
      />
      {data !== null && (
        <DescriptionSection value={data.description} path={path} onEdit={onEdit} />
      )}
      {data !== null && data.properties !== undefined && (
        <Box className={classes.section}>
          <Title order={2} size="h4" c="gray.1" fw={700} mb="xs">
            Properties
          </Title>
          <PropertyList changeSet={data.properties} />
        </Box>
      )}
      {data !== null && (
        <ChangeSummary
          behaviours={data.behaviours}
          rules={data.rules}
          scenarios={data.scenarios}
        />
      )}
    </Stack>
  );
}

function BehaviorDetails({
  data,
  status,
  name,
  path,
  onEdit,
}: DetailsProps<DesignedBehaviourData>) {
  return (
    <Stack gap={0}>
      <DetailsHeader
        kind="behavior"
        name={data?.name ?? name}
        status={status}
        subtitle={behaviorSubtitle(data)}
        path={path}
        onEdit={onEdit}
      />
      {data !== null && (
        <>
          <DescriptionSection value={data.description} path={path} onEdit={onEdit} />
          {data.actor !== null && data.actor !== "" && (
            <Box className={classes.section}>
              <KvRow label="Actor" value={data.actor} />
            </Box>
          )}
        </>
      )}
      {data !== null && data.input !== undefined && (
        <Box className={classes.section}>
          <Title order={2} size="h4" c="gray.1" fw={700} mb="xs">
            Input
          </Title>
          <StringChangeSetList changeSet={data.input} />
        </Box>
      )}
      {data !== null && data.output !== undefined && (
        <Box className={classes.section}>
          <Title order={2} size="h4" c="gray.1" fw={700} mb="xs">
            Output
          </Title>
          <StringChangeSetList changeSet={data.output} />
        </Box>
      )}
      {data !== null && data.usedBuildingBlocks !== undefined && (
        <Box className={classes.section}>
          <Title order={2} size="h4" c="gray.1" fw={700} mb="xs">
            Used Building Blocks
          </Title>
          <StringChangeSetList changeSet={data.usedBuildingBlocks} />
        </Box>
      )}
      {data !== null && (
        <ChangeSummary rules={data.rules} scenarios={data.scenarios} />
      )}
    </Stack>
  );
}

function RuleDetails({
  data,
  status,
  name,
  path,
  onEdit,
}: DetailsProps<DesignedRuleData>) {
  return (
    <Stack gap={0}>
      <DetailsHeader
        kind="rule"
        name={data?.name ?? name}
        status={status}
        subtitle={data?.ruleType ?? undefined}
        path={path}
        onEdit={onEdit}
      />
      {data !== null && (
        <DescriptionSection value={data.description} path={path} onEdit={onEdit} />
      )}
    </Stack>
  );
}

function ScenarioDetails({
  data,
  status,
  name,
  path,
  onEdit,
}: DetailsProps<DesignedScenarioData>) {
  return (
    <Stack gap={0}>
      <DetailsHeader
        kind="scenario"
        name={data?.name ?? name}
        status={status}
        path={path}
        onEdit={onEdit}
      />
      {data !== null && (
        <DescriptionSection value={data.description} path={path} onEdit={onEdit} />
      )}
      {data !== null && (
        <Box className={classes.section}>
          <Stack gap="md">
            <KvRow label="Given" value={data.given} />
            <KvRow label="When" value={data.when} />
            <KvRow label="Then" value={data.then} />
          </Stack>
        </Box>
      )}
    </Stack>
  );
}

function ChangeSummary({
  modules,
  buildingBlocks,
  behaviours,
  rules,
  scenarios,
}: {
  modules?: DesignDocChangeSet<DesignedDomainModuleData>;
  buildingBlocks?: DesignDocChangeSet<DesignedBuildingBlockData>;
  behaviours?: DesignDocChangeSet<DesignedBehaviourData>;
  rules?: DesignDocChangeSet<DesignedRuleData>;
  scenarios?: DesignDocChangeSet<DesignedScenarioData>;
}) {
  const sections: Array<{ label: string; cs: { added: unknown[]; removed: string[]; modified: unknown[] } }> = [];
  if (modules !== undefined) sections.push({ label: "Modules", cs: modules });
  if (buildingBlocks !== undefined)
    sections.push({ label: "Building Blocks", cs: buildingBlocks });
  if (behaviours !== undefined) sections.push({ label: "Behaviors", cs: behaviours });
  if (rules !== undefined) sections.push({ label: "Rules", cs: rules });
  if (scenarios !== undefined) sections.push({ label: "Scenarios", cs: scenarios });
  if (sections.length === 0) return null;
  return (
    <Box className={classes.section}>
      <Title order={2} size="h4" c="gray.1" fw={700} mb="xs">
        Changes
      </Title>
      <Stack gap="xs">
        {sections.map((s) => (
          <Group key={s.label} gap="md" wrap="wrap">
            <Text size="sm" fw={600} c="gray.2" w={140}>
              {s.label}
            </Text>
            <ChangeCounts cs={s.cs} />
          </Group>
        ))}
      </Stack>
    </Box>
  );
}

function ChangeCounts({
  cs,
}: {
  cs: { added: unknown[]; removed: string[]; modified: unknown[] };
}) {
  return (
    <Group gap={6}>
      <Badge size="xs" variant="light" color="noesisGreen" radius="xl">
        +{cs.added.length} added
      </Badge>
      <Badge size="xs" variant="light" color="yellow" radius="xl">
        ~{cs.modified.length} modified
      </Badge>
      <Badge size="xs" variant="light" color="red" radius="xl">
        −{cs.removed.length} removed
      </Badge>
    </Group>
  );
}

function StringChangeSetList({
  changeSet,
}: {
  changeSet: DesignDocChangeSet<string>;
}) {
  return (
    <Stack gap={6}>
      {changeSet.added.map((s) => (
        <ChangeChip key={`a:${s}`} status="added" label={s} />
      ))}
      {changeSet.modified.map((s) => (
        <ChangeChip key={`m:${s}`} status="modified" label={s} />
      ))}
      {changeSet.removed.map((s) => (
        <ChangeChip key={`r:${s}`} status="removed" label={s} />
      ))}
      {changeSet.added.length === 0 &&
        changeSet.modified.length === 0 &&
        changeSet.removed.length === 0 && (
          <Text size="sm" c="dimmed">
            (no changes)
          </Text>
        )}
    </Stack>
  );
}

function PropertyList({
  changeSet,
}: {
  changeSet: DesignDocChangeSet<{ name: string; type: string | null }>;
}) {
  if (
    changeSet.added.length === 0 &&
    changeSet.modified.length === 0 &&
    changeSet.removed.length === 0
  ) {
    return (
      <Text size="sm" c="dimmed">
        (no property changes)
      </Text>
    );
  }
  return (
    <Stack gap={6}>
      {changeSet.added.map((p) => (
        <ChangeChip
          key={`a:${p.name}`}
          status="added"
          label={p.type !== null ? `${p.name}: ${p.type}` : p.name}
        />
      ))}
      {changeSet.modified.map((p) => (
        <ChangeChip
          key={`m:${p.name}`}
          status="modified"
          label={p.type !== null ? `${p.name}: ${p.type}` : p.name}
        />
      ))}
      {changeSet.removed.map((s) => (
        <ChangeChip key={`r:${s}`} status="removed" label={s} />
      ))}
    </Stack>
  );
}

function ChangeChip({
  status,
  label,
}: {
  status: ChangeStatus;
  label: string;
}) {
  return (
    <Badge
      size="sm"
      variant="light"
      color={statusMantineColor(status)}
      radius="xl"
    >
      <span className={statusClass(status)}>{label}</span>
    </Badge>
  );
}

function StatusBadge({ status }: { status: ChangeStatus }) {
  return (
    <Badge
      size="xs"
      variant="light"
      color={statusMantineColor(status)}
      radius="xl"
    >
      {status}
    </Badge>
  );
}

function KvRow({ label, value }: { label: string; value: string }) {
  return (
    <Box className={classes.kvRow}>
      <Text className={classes.kvKey}>{label}</Text>
      {value === "" || value === "—" ? (
        <Text className={classes.kvValue}>{value}</Text>
      ) : (
        <MarkdownContent text={value} />
      )}
    </Box>
  );
}

function buildTree(source: DesignDocSourceData): TreeNode[] {
  const docId = source.id;
  const sections: TreeNode[] = [];

  if (source.actors !== undefined) {
    sections.push({
      id: `${docId}|sec:actors`,
      kind: "section",
      label: "Actors",
      status: null,
      payload: null,
      path: [],
      children: actorChildren(docId, source.actors),
    });
  }

  if (source.boundedContexts !== undefined) {
    sections.push({
      id: `${docId}|sec:bounded-contexts`,
      kind: "section",
      label: "Bounded Contexts",
      status: null,
      payload: null,
      path: [],
      children: boundedContextChildren(docId, source.boundedContexts),
    });
  }

  if (source.qualityAttributes !== undefined) {
    sections.push({
      id: `${docId}|sec:quality-attributes`,
      kind: "section",
      label: "Quality Attributes",
      status: null,
      payload: null,
      path: [],
      children: qualityAttributeChildren(docId, source.qualityAttributes),
    });
  }

  return sections;
}

function appendSegment(
  parentPath: ElementPathSegment[],
  kind: ElementKind,
  name: string,
): ElementPathSegment[] {
  return [...parentPath, { kind, name }];
}

function actorChildren(
  parentId: string,
  cs: DesignDocChangeSet<DesignedActorData>,
): TreeNode[] {
  const out: TreeNode[] = [];
  for (const a of cs.added) {
    out.push(actorNode(parentId, a, "added"));
  }
  for (const a of cs.modified) {
    out.push(actorNode(parentId, a, "modified"));
  }
  for (const name of cs.removed) {
    out.push({
      id: `${parentId}|actor:${name}`,
      kind: "actor",
      label: name,
      status: "removed",
      payload: { kind: "actor", data: null },
      path: appendSegment([], "actor", name),
      children: [],
    });
  }
  return out;
}

function actorNode(
  parentId: string,
  data: DesignedActorData,
  status: ChangeStatus,
): TreeNode {
  return {
    id: `${parentId}|actor:${data.name}`,
    kind: "actor",
    label: data.name,
    status,
    payload: { kind: "actor", data },
    path: appendSegment([], "actor", data.name),
    children: [],
  };
}

function qualityAttributeChildren(
  parentId: string,
  cs: DesignDocChangeSet<DesignedQualityAttributeData>,
): TreeNode[] {
  const out: TreeNode[] = [];
  for (const q of cs.added) {
    out.push(qaNode(parentId, q, "added"));
  }
  for (const q of cs.modified) {
    out.push(qaNode(parentId, q, "modified"));
  }
  for (const name of cs.removed) {
    out.push({
      id: `${parentId}|qa:${name}`,
      kind: "qualityAttribute",
      label: name,
      status: "removed",
      payload: { kind: "qualityAttribute", data: null },
      path: appendSegment([], "qualityAttribute", name),
      children: [],
    });
  }
  return out;
}

function qaNode(
  parentId: string,
  data: DesignedQualityAttributeData,
  status: ChangeStatus,
): TreeNode {
  return {
    id: `${parentId}|qa:${data.name}`,
    kind: "qualityAttribute",
    label: data.name,
    status,
    payload: { kind: "qualityAttribute", data },
    path: appendSegment([], "qualityAttribute", data.name),
    children: [],
  };
}

function boundedContextChildren(
  parentId: string,
  cs: DesignDocChangeSet<DesignedBoundedContextData>,
): TreeNode[] {
  const out: TreeNode[] = [];
  for (const bc of cs.added) {
    out.push(bcNode(parentId, bc, "added"));
  }
  for (const bc of cs.modified) {
    out.push(bcNode(parentId, bc, "modified"));
  }
  for (const name of cs.removed) {
    out.push({
      id: `${parentId}|bc:${name}`,
      kind: "boundedContext",
      label: name,
      status: "removed",
      payload: { kind: "boundedContext", data: null },
      path: appendSegment([], "boundedContext", name),
      children: [],
    });
  }
  return out;
}

function bcNode(
  parentId: string,
  data: DesignedBoundedContextData,
  status: ChangeStatus,
): TreeNode {
  const id = `${parentId}|bc:${data.name}`;
  const path = appendSegment([], "boundedContext", data.name);
  const children: TreeNode[] = [];
  if (data.modules !== undefined) {
    for (const m of data.modules.added)
      children.push(moduleNode(id, path, m, "added"));
    for (const m of data.modules.modified)
      children.push(moduleNode(id, path, m, "modified"));
    for (const name of data.modules.removed) {
      children.push({
        id: `${id}|module:${name}`,
        kind: "module",
        label: name,
        status: "removed",
        payload: { kind: "module", data: null },
        path: appendSegment(path, "module", name),
        children: [],
      });
    }
  }
  if (data.buildingBlocks !== undefined) {
    for (const bb of data.buildingBlocks.added)
      children.push(buildingBlockNode(id, path, bb, "added"));
    for (const bb of data.buildingBlocks.modified)
      children.push(buildingBlockNode(id, path, bb, "modified"));
    for (const name of data.buildingBlocks.removed) {
      children.push({
        id: `${id}|bb:${name}`,
        kind: "buildingBlock",
        label: name,
        status: "removed",
        payload: { kind: "buildingBlock", data: null },
        path: appendSegment(path, "buildingBlock", name),
        children: [],
      });
    }
  }
  return {
    id,
    kind: "boundedContext",
    label: data.name,
    status,
    payload: { kind: "boundedContext", data },
    path,
    children,
  };
}

function moduleNode(
  parentId: string,
  parentPath: ElementPathSegment[],
  data: DesignedDomainModuleData,
  status: ChangeStatus,
): TreeNode {
  const id = `${parentId}|module:${data.name}`;
  const path = appendSegment(parentPath, "module", data.name);
  const children: TreeNode[] = [];
  if (data.buildingBlocks !== undefined) {
    for (const bb of data.buildingBlocks.added)
      children.push(buildingBlockNode(id, path, bb, "added"));
    for (const bb of data.buildingBlocks.modified)
      children.push(buildingBlockNode(id, path, bb, "modified"));
    for (const name of data.buildingBlocks.removed) {
      children.push({
        id: `${id}|bb:${name}`,
        kind: "buildingBlock",
        label: name,
        status: "removed",
        payload: { kind: "buildingBlock", data: null },
        path: appendSegment(path, "buildingBlock", name),
        children: [],
      });
    }
  }
  return {
    id,
    kind: "module",
    label: data.name,
    status,
    payload: { kind: "module", data },
    path,
    children,
  };
}

function buildingBlockNode(
  parentId: string,
  parentPath: ElementPathSegment[],
  data: DesignedBuildingBlockData,
  status: ChangeStatus,
): TreeNode {
  const id = `${parentId}|bb:${data.name}`;
  const path = appendSegment(parentPath, "buildingBlock", data.name);
  const children: TreeNode[] = [];
  if (data.behaviours !== undefined) {
    for (const bh of data.behaviours.added)
      children.push(behaviorNode(id, path, bh, "added"));
    for (const bh of data.behaviours.modified)
      children.push(behaviorNode(id, path, bh, "modified"));
    for (const name of data.behaviours.removed) {
      children.push({
        id: `${id}|behavior:${name}`,
        kind: "behavior",
        label: name,
        status: "removed",
        payload: { kind: "behavior", data: null },
        path: appendSegment(path, "behavior", name),
        children: [],
      });
    }
  }
  if (data.rules !== undefined) {
    for (const r of data.rules.added) children.push(ruleNode(id, path, r, "added"));
    for (const r of data.rules.modified)
      children.push(ruleNode(id, path, r, "modified"));
    for (const name of data.rules.removed) {
      children.push({
        id: `${id}|rule:${name}`,
        kind: "rule",
        label: name,
        status: "removed",
        payload: { kind: "rule", data: null },
        path: appendSegment(path, "rule", name),
        children: [],
      });
    }
  }
  if (data.scenarios !== undefined) {
    for (const s of data.scenarios.added)
      children.push(scenarioNode(id, path, s, "added"));
    for (const s of data.scenarios.modified)
      children.push(scenarioNode(id, path, s, "modified"));
    for (const name of data.scenarios.removed) {
      children.push({
        id: `${id}|scenario:${name}`,
        kind: "scenario",
        label: name,
        status: "removed",
        payload: { kind: "scenario", data: null },
        path: appendSegment(path, "scenario", name),
        children: [],
      });
    }
  }
  return {
    id,
    kind: "buildingBlock",
    label: data.name,
    status,
    payload: { kind: "buildingBlock", data },
    path,
    children,
  };
}

function behaviorNode(
  parentId: string,
  parentPath: ElementPathSegment[],
  data: DesignedBehaviourData,
  status: ChangeStatus,
): TreeNode {
  const id = `${parentId}|behavior:${data.name}`;
  const path = appendSegment(parentPath, "behavior", data.name);
  const children: TreeNode[] = [];
  if (data.rules !== undefined) {
    for (const r of data.rules.added) children.push(ruleNode(id, path, r, "added"));
    for (const r of data.rules.modified)
      children.push(ruleNode(id, path, r, "modified"));
    for (const name of data.rules.removed) {
      children.push({
        id: `${id}|rule:${name}`,
        kind: "rule",
        label: name,
        status: "removed",
        payload: { kind: "rule", data: null },
        path: appendSegment(path, "rule", name),
        children: [],
      });
    }
  }
  if (data.scenarios !== undefined) {
    for (const s of data.scenarios.added)
      children.push(scenarioNode(id, path, s, "added"));
    for (const s of data.scenarios.modified)
      children.push(scenarioNode(id, path, s, "modified"));
    for (const name of data.scenarios.removed) {
      children.push({
        id: `${id}|scenario:${name}`,
        kind: "scenario",
        label: name,
        status: "removed",
        payload: { kind: "scenario", data: null },
        path: appendSegment(path, "scenario", name),
        children: [],
      });
    }
  }
  return {
    id,
    kind: "behavior",
    label: data.name,
    status,
    payload: { kind: "behavior", data },
    path,
    children,
  };
}

function ruleNode(
  parentId: string,
  parentPath: ElementPathSegment[],
  data: DesignedRuleData,
  status: ChangeStatus,
): TreeNode {
  return {
    id: `${parentId}|rule:${data.name}`,
    kind: "rule",
    label: data.name,
    status,
    payload: { kind: "rule", data },
    path: appendSegment(parentPath, "rule", data.name),
    children: [],
  };
}

function scenarioNode(
  parentId: string,
  parentPath: ElementPathSegment[],
  data: DesignedScenarioData,
  status: ChangeStatus,
): TreeNode {
  return {
    id: `${parentId}|scenario:${data.name}`,
    kind: "scenario",
    label: data.name,
    status,
    payload: { kind: "scenario", data },
    path: appendSegment(parentPath, "scenario", data.name),
    children: [],
  };
}

function findNode(nodes: TreeNode[], id: string): TreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findNode(n.children, id);
    if (found !== null) return found;
  }
  return null;
}

function statusMantineColor(status: ChangeStatus): string {
  switch (status) {
    case "added":
      return "noesisGreen";
    case "modified":
      return "yellow";
    case "removed":
      return "red";
  }
}

function statusBgColor(status: ChangeStatus): string {
  switch (status) {
    case "added":
      return "var(--mantine-color-noesisGreen-5)";
    case "modified":
      return "var(--mantine-color-yellow-5)";
    case "removed":
      return "var(--mantine-color-red-5)";
  }
}

function statusClass(status: ChangeStatus): string {
  switch (status) {
    case "added":
      return classes.statusAdded;
    case "modified":
      return classes.statusModified;
    case "removed":
      return classes.statusRemoved;
  }
}

function kindLabel(kind: TreeNodeKind): string {
  switch (kind) {
    case "section":
      return "Section";
    case "actor":
      return "Actor";
    case "boundedContext":
      return "Bounded Context";
    case "module":
      return "Module";
    case "buildingBlock":
      return "Building Block";
    case "behavior":
      return "Behavior";
    case "rule":
      return "Rule";
    case "scenario":
      return "Scenario";
    case "qualityAttribute":
      return "Quality Attribute";
  }
}

function behaviorSubtitle(data: DesignedBehaviourData | null): string | undefined {
  if (data === null) return undefined;
  const parts: string[] = [];
  if (data.type !== null && data.type !== "") parts.push(data.type);
  if (data.isPublic) parts.push("public");
  return parts.length > 0 ? parts.join(" · ") : undefined;
}
