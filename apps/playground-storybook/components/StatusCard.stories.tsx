import type { Meta, StoryObj } from "@storybook/react-vite";

import { StatusCard } from "./StatusCard.js";

const meta = {
  title: "Topo/StatusCard",
  component: StatusCard,
  tags: ["autodocs"],
} satisfies Meta<typeof StatusCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Healthy: Story = {
  args: {
    title: "Preview runtime connected",
    detail: "The selected component state is ready for capture.",
    tone: "healthy",
  },
};

export const Warning: Story = {
  args: {
    title: "Fixture missing",
    detail: "This route needs deterministic customer data before review.",
    tone: "warning",
  },
};

export const Loading: Story = {
  args: {
    title: "Refreshing source evidence",
    detail: "Topo is rebuilding only the affected component snapshot.",
    tone: "loading",
  },
};
