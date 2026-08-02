import { customizeStudio } from "../studio-config";
import { useStudio } from "../studio-runtime";

function ReviewDestination() {
  const { data } = useStudio();
  return (
    <section className="extension-example">
      <span className="extension-example-kicker">CUSTOM DESTINATION</span>
      <h1>Review queue</h1>
      <p>
        This screen was added through one Studio definition. The shell, route
        matcher, navigation, command palette, and status bar discovered it
        automatically.
      </p>
      <div className="extension-example-stats">
        <strong>{data.graph.findings.length}</strong>
        <span>findings ready for review</span>
      </div>
    </section>
  );
}

/**
 * Copyable extension fixture. Open `?studio=review` to run it locally.
 * `false` removes built-ins; keyed objects add or replace them.
 */
export const reviewStudio = customizeStudio({
  remove: {
    destinations: ["editor"],
    commands: ["capture"],
  },
  destinations: {
    reviews: {
      label: "Reviews",
      component: ReviewDestination,
      status: ({ data }) => `${data.graph.findings.length} findings to review`,
    },
  },
  commands: {
    openReviews: ({ actions }) => actions.go("reviews"),
  },
});
