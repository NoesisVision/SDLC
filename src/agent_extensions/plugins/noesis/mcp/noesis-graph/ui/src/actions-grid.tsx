import { Card, SimpleGrid, Stack, Text, UnstyledButton, useMantineTheme } from "@mantine/core";
import type { ComponentType } from "react";
import classes from "./actions-grid.module.css";

export interface ActionItem {
  title: string;
  icon: ComponentType<{ size?: number; stroke?: number; color?: string }>;
  color: string;
  onClick: () => void;
}

interface ActionsGridProps {
  title: string;
  items: ActionItem[];
  cols?: number;
}

export function ActionsGrid({ title, items, cols = 3 }: ActionsGridProps) {
  const theme = useMantineTheme();

  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed" fw={500} tt="uppercase">
        {title}
      </Text>
      <Card withBorder radius="md" className={classes.card}>
        <SimpleGrid cols={cols}>
          {items.map((item) => (
            <UnstyledButton
              key={item.title}
              className={classes.item}
              onClick={item.onClick}
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
          ))}
        </SimpleGrid>
      </Card>
    </Stack>
  );
}
