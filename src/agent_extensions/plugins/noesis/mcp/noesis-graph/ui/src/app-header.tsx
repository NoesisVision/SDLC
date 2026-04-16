import { ActionIcon, Anchor, Group, Text } from "@mantine/core";
import { IconBrandGithub } from "@tabler/icons-react";

export function AppHeader() {
  return (
    <Group justify="space-between" h="100%" px="md">
      <Anchor
        href="http://noesis.vision"
        target="_blank"
        underline="never"
      >
        <Text
          fw={700}
          size="lg"
          variant="gradient"
          gradient={{ from: "#4f46e5", to: "#4ade80", deg: 135 }}
        >
          Noesis
        </Text>
      </Anchor>
      <ActionIcon
        component="a"
        href="https://github.com/NoesisVision"
        target="_blank"
        variant="subtle"
        color="gray"
        size="lg"
      >
        <IconBrandGithub size={22} stroke={1.5} />
      </ActionIcon>
    </Group>
  );
}
