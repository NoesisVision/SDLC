import { Container, Text } from "@mantine/core";

function PageShell({ title }: { title: string }) {
  return (
    <Container size="lg" py="xl">
      <Text component="h1" size="xl" fw={700} c="gray.1">
        {title}
      </Text>
    </Container>
  );
}

export function TopicsPage() {
  return <PageShell title="Topics" />;
}

export function DecisionsPage() {
  return <PageShell title="Decisions" />;
}

export function ModelPage() {
  return <PageShell title="Model" />;
}

export function GraphPage() {
  return <PageShell title="Graph Schema" />;
}
