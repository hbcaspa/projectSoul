import BrainCanvas from "../components/brain/BrainCanvas";
import ActivityFeed from "../components/brain/ActivityFeed";
import { useActiveNodes, useActivityFeed } from "../lib/store";

export default function BrainView() {
  const { nodes, isWorking } = useActiveNodes();
  const feed = useActivityFeed();

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: "var(--bg-base)" }}>
      {/* Brain visualization — takes most space */}
      <div className="flex-1 min-h-0">
        <BrainCanvas activeNodes={nodes} isWorking={isWorking} />
      </div>

      {/* Activity feed — bottom section */}
      <div
        className="border-t border-white/5 overflow-auto"
        style={{ maxHeight: "180px", backgroundColor: "var(--bg-surface)" }}
      >
        <ActivityFeed feed={feed} activeNodes={nodes} />
      </div>
    </div>
  );
}
