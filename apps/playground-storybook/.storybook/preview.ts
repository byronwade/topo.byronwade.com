import type { Preview } from "@storybook/react-vite";

const preview: Preview = {
  parameters: {
    backgrounds: { default: "topo" },
    layout: "centered",
  },
  initialGlobals: {
    backgrounds: { value: "#10110f" },
  },
};

export default preview;
