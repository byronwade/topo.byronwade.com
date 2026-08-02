import { ExternalLink } from "lucide-react";

import type { StudioCustomizationResponse } from "@topo/protocol";

import {
  customizeStudio,
  type TopoStudioCommandInput,
  type TopoStudioDefinition,
  type TopoStudioDestinationInput,
} from "./studio-config";

export interface ProjectStudioComposition {
  definition: TopoStudioDefinition;
  issues: readonly string[];
}

function ProjectDestinationFrame({
  label,
  url,
}: {
  label: string;
  url: string;
}) {
  return (
    <section className="project-destination-frame">
      <div className="project-destination-strip">
        <span>LOCAL STUDIO EXTENSION</span>
        <a href={url} rel="noreferrer" target="_blank">
          Open separately <ExternalLink size={12} />
        </a>
      </div>
      <iframe
        referrerPolicy="no-referrer"
        sandbox="allow-downloads allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
        src={url}
        title={label}
      />
    </section>
  );
}

/** Compose a validated project manifest without letting bad config blank Studio. */
export function composeProjectStudio(
  base: TopoStudioDefinition,
  manifest: StudioCustomizationResponse,
): ProjectStudioComposition {
  try {
    const destinations: Record<string, TopoStudioDestinationInput> = {};
    for (const [id, destination] of Object.entries(manifest.destinations)) {
      if (!destination.url) {
        if (!base.destinations[id]) {
          throw new Error(
            `New project Studio destination "${id}" needs a loopback URL`,
          );
        }
        destinations[id] = {
          ...(destination.label ? { label: destination.label } : {}),
          ...(destination.description
            ? { description: destination.description }
            : {}),
          ...(destination.path ? { path: destination.path } : {}),
          ...(destination.statusBar === undefined
            ? {}
            : { statusBar: destination.statusBar }),
        };
        continue;
      }

      const label = destination.label;
      const destinationUrl = destination.url;
      const Frame = () => (
        <ProjectDestinationFrame label={label ?? id} url={destinationUrl} />
      );
      Frame.displayName = `TopoProjectDestination(${id})`;
      destinations[id] = {
        ...(label ? { label } : {}),
        description:
          destination.description ??
          `Local project extension at ${destinationUrl}`,
        ...(destination.path ? { path: destination.path } : {}),
        icon: ExternalLink,
        component: Frame,
        tools: "none",
        primaryAction: "none",
        ...(destination.statusBar === undefined
          ? {}
          : { statusBar: destination.statusBar }),
        status: () => new URL(destinationUrl).origin,
      };
    }

    const availableDestinations = new Set(Object.keys(base.destinations));
    for (const id of manifest.remove.destinations) {
      availableDestinations.delete(id);
    }
    for (const id of Object.keys(manifest.destinations)) {
      availableDestinations.add(id);
    }
    for (const [id, command] of Object.entries(manifest.commands)) {
      if (!command.to && !base.commands[id]) {
        throw new Error(
          `New project Studio command "${id}" needs a destination in "to"`,
        );
      }
      if (command.to && !availableDestinations.has(command.to)) {
        throw new Error(
          `Project Studio command "${id}" targets missing destination "${command.to}"`,
        );
      }
    }

    const commands: Record<string, TopoStudioCommandInput> = {};
    for (const [id, command] of Object.entries(manifest.commands)) {
      commands[id] = command.to
        ? {
            ...(command.label ? { label: command.label } : {}),
            ...(command.shortcut ? { shortcut: command.shortcut } : {}),
            icon: ExternalLink,
            run: ({ actions }) => actions.go(command.to!, command.view),
          }
        : {
            ...(command.label ? { label: command.label } : {}),
            ...(command.shortcut ? { shortcut: command.shortcut } : {}),
          };
    }

    return {
      definition: customizeStudio(
        {
          defaultDestination: manifest.defaultDestination,
          remove: manifest.remove,
          destinations,
          commands,
        },
        base,
      ),
      issues: [],
    };
  } catch (error) {
    return {
      definition: base,
      issues: [
        error instanceof Error
          ? `Project Studio customization was ignored: ${error.message}`
          : "Project Studio customization was ignored",
      ],
    };
  }
}
