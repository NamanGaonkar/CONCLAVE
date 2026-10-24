import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useStore, type Agent } from '@/store/store';
import { parseTasks, type HiveTask } from '@/components/TasksKanban';

// Line color palette matching Ember Dark theme
const LINE_COLORS: Record<string, { main: string; bright: string; glow: string; bg: string }> = {
  amber:  { main: '#F5AF28', bright: '#FFD15C', glow: 'rgba(245, 175, 40, 0.45)', bg: '#2A1F0B' },
  coral:  { main: '#E06D53', bright: '#FF8A65', glow: 'rgba(224, 109, 83, 0.45)', bg: '#321B17' },
  mint:   { main: '#48B57D', bright: '#6EE7B7', glow: 'rgba(72, 181, 125, 0.45)', bg: '#162E21' },
  sky:    { main: '#55A6BF', bright: '#7DD3FC', glow: 'rgba(85, 166, 191, 0.45)', bg: '#172A32' },
  lilac:  { main: '#9D85D6', bright: '#C4B5FD', glow: 'rgba(157, 133, 214, 0.45)', bg: '#251E33' },
  peach:  { main: '#E09253', bright: '#FDBA74', glow: 'rgba(224, 146, 83, 0.45)', bg: '#322116' },
};

const DEFAULT_LINE_COLOR = LINE_COLORS.amber;

interface MetroStation {
  task: HiveTask;
  x: number;
  y: number;
  agentId?: string;
  isMerge?: boolean;
  hasConflict?: boolean;
  isRedirect?: boolean;
  redirectLabel?: string;
}

interface MetroLine {
  agent: Agent;
  color: { main: string; bright: string; glow: string; bg: string };
  y: number;
  isGod: boolean;
  stations: MetroStation[];
  pathD: string;
  isWorking: boolean;
}

export function BranchMetroView() {
  const agents = useStore((s) => s.agents);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const openTaskDetail = useStore((s) => s.openTaskDetail);
  const setSidebarTab = useStore((s) => s.setSidebarTab);

  const [tasks, setTasks] = useState<HiveTask[]>([]);
  const [selectedStation, setSelectedStation] = useState<MetroStation | null>(null);

  // Pan & Zoom state
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [zoom, setZoom] = useState(1);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });

  // Train animation tick
  const [trainTime, setTrainTime] = useState(0);

  // Poll tasks every 3s
  const fetchTasks = useCallback(async () => {
    try {
      if (window.cth && typeof window.cth.hiveTasks === 'function') {
        const raw = await window.cth.hiveTasks();
        setTasks(parseTasks(raw));
      }
    } catch {
      // keep previous
    }
  }, []);

  useEffect(() => {
    void fetchTasks();
    const interval = setInterval(fetchTasks, 3000);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  // Train animation loop
  useEffect(() => {
    let animId: number;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setTrainTime((t) => (t + dt * 0.4) % 1);
      animId = requestAnimationFrame(loop);
    };
    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, []);

  // Compute Subway Map Graph Geometry
  const { lines, junctions, redirects, totalWidth, totalHeight } = useMemo(() => {
    const list: MetroLine[] = [];
    const colorKeys = Object.keys(LINE_COLORS);

    // Sort agents: Lead agent (isGod) in center, others distributed
    const sortedAgents = [...agents].sort((a, b) => {
      if (a.isGod) return -1;
      if (b.isGod) return 1;
      return a.name.localeCompare(b.name);
    });

    const ROW_HEIGHT = 130;
    const START_X = 220;
    const STATION_GAP = 180;
    const END_PADDING = 240;

    // Determine max stations across lines for SVG canvas bounds
    let maxStationCount = 3;

    sortedAgents.forEach((agent, index) => {
      const agentTasks = tasks.filter((t) => t.assignee === agent.id);
      // If Lead agent, also include unassigned tasks
      const allLineTasks = agent.isGod
        ? [...agentTasks, ...tasks.filter((t) => !t.assignee || !agents.some((a) => a.id === t.assignee))]
        : agentTasks;

      if (allLineTasks.length > maxStationCount) {
        maxStationCount = allLineTasks.length;
      }

      const colorKey = agent.isGod ? 'amber' : (colorKeys[(index) % colorKeys.length] || 'sky');
      const color = LINE_COLORS[colorKey] || DEFAULT_LINE_COLOR;
      const y = 140 + index * ROW_HEIGHT;

      const stations: MetroStation[] = allLineTasks.map((task, sIdx) => {
        const x = START_X + sIdx * STATION_GAP;
        const isMerge = (task.dependsOn && task.dependsOn.length > 0) || task.status === 'done';
        const hasConflict = task.status === 'blocked' || agent.status === 'blocked';
        const isRedirect = task.status === 'blocked' || (task.humanQA && task.humanQA.length > 0);
        const redirectLabel = isRedirect ? 'SWITCH ↗ ESCALATION' : undefined;

        return {
          task,
          x,
          y,
          agentId: agent.id,
          isMerge,
          hasConflict,
          isRedirect,
          redirectLabel
        };
      });

      // Default mock terminal stops if no tasks yet
      if (stations.length === 0) {
        stations.push({
          task: {
            id: `init-${agent.id}`,
            title: agent.isGod ? 'Conclave Command' : `${agent.name} Depot`,
            status: agent.status === 'working' ? 'doing' : 'todo',
            dependsOn: [],
            priority: 1,
            createdAt: new Date().toISOString()
          },
          x: START_X,
          y,
          agentId: agent.id,
          isMerge: false,
          hasConflict: agent.status === 'blocked',
          isRedirect: false
        });
      }

      const lastX = Math.max(START_X + (stations.length - 1) * STATION_GAP + END_PADDING, 900);
      const pathD = `M 60 ${y} L ${lastX} ${y}`;
      const isWorking = agent.status === 'working' || agent.status === 'thinking';

      list.push({
        agent,
        color,
        y,
        isGod: !!agent.isGod,
        stations,
        pathD,
        isWorking
      });
    });

    // Detect junctions between lines (merges and dependencies)
    const junctionList: Array<{
      id: string;
      x: number;
      fromY: number;
      toY: number;
      hasConflict: boolean;
      label: string;
    }> = [];

    // Redirect switches
    const redirectList: Array<{
      id: string;
      x: number;
      y: number;
      targetY: number;
      label: string;
    }> = [];

    list.forEach((line) => {
      line.stations.forEach((st) => {
        if (st.isMerge && line.isGod === false) {
          // Merge towards Lead line (index 0)
          const targetY = list[0]?.y ?? 140;
          junctionList.push({
            id: `junc-${st.task.id}`,
            x: st.x + 60,
            fromY: st.y,
            toY: targetY,
            hasConflict: !!st.hasConflict,
            label: st.task.status === 'done' ? 'MERGE: COMPLETED' : 'TRANSFER JUNCTION'
          });
        }
        if (st.isRedirect) {
          redirectList.push({
            id: `redir-${st.task.id}`,
            x: st.x + 30,
            y: st.y,
            targetY: st.y - 38,
            label: st.redirectLabel || 'TRACK SWITCH ↗'
          });
        }
      });
    });

    const calculatedWidth = Math.max(START_X + maxStationCount * STATION_GAP + 300, 1200);
    const calculatedHeight = Math.max(140 + sortedAgents.length * ROW_HEIGHT + 100, 600);

    return {
      lines: list,
      junctions: junctionList,
      redirects: redirectList,
      totalWidth: calculatedWidth,
      totalHeight: calculatedHeight
    };
  }, [agents, tasks]);

  // Handle station click: select agent, open task detail, open changes (git)
  const handleStationClick = (station: MetroStation) => {
    setSelectedStation(station);
    if (station.agentId) {
      select(station.agentId);
    }
    // Switch to git changes to inspect work
    setSidebarTab('git');
    // Open task details overlay if it's a real task
    if (!station.task.id.startsWith('init-')) {
      openTaskDetail(station.task.id);
    }
  };

  // Mouse drag handlers for Pan
  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.interactive-node')) return;
    isDragging.current = true;
    dragStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current) return;
    setPan({
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y
    });
  };

  const handleMouseUp = () => {
    isDragging.current = false;
  };

  // Wheel handler for Zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.1 : -0.1;
    setZoom((z) => Math.min(Math.max(z + delta, 0.4), 2.2));
  };

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: '#0C0A07',
        userSelect: 'none',
        fontFamily: 'Lato, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
    >
      {/* Metro Map Schematic Background Grid */}
      <svg
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none'
        }}
      >
        <defs>
          <pattern id="metroGrid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1B1710" strokeWidth="1" />
            <circle cx="0" cy="0" r="1.5" fill="#2A2417" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#metroGrid)" />
      </svg>

      {/* Main Vector SVG Subway System */}
      <svg
        viewBox={`0 0 ${totalWidth} ${totalHeight}`}
        style={{
          position: 'absolute',
          width: totalWidth,
          height: totalHeight,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
          cursor: isDragging.current ? 'grabbing' : 'grab',
          transition: isDragging.current ? 'none' : 'transform 0.05s ease-out'
        }}
      >
        <defs>
          {/* Glowing Filters */}
          <filter id="amberGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="trainGlow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="signalPulse" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Gradients */}
          <linearGradient id="headlightBeam" x1="0%" y1="50%" x2="100%" y2="50%">
            <stop offset="0%" stopColor="#FFD15C" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#FFD15C" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* 1. LAYER: Merge Junction Tracks & Curves */}
        {junctions.map((j) => {
          const dy = j.toY - j.fromY;
          const curveX1 = j.x;
          const curveY1 = j.fromY;
          const curveX2 = j.x + 40;
          const curveY2 = j.toY;
          const path = `M ${curveX1} ${curveY1} C ${curveX1 + 30} ${curveY1}, ${curveX2 - 30} ${curveY2}, ${curveX2} ${curveY2}`;

          return (
            <g key={j.id} className="metro-junction">
              {/* Under-track casing */}
              <path
                d={path}
                fill="none"
                stroke="#0C0A07"
                strokeWidth="12"
                strokeLinecap="round"
              />
              {/* Junction Connector Track */}
              <path
                d={path}
                fill="none"
                stroke="#2A2417"
                strokeWidth="6"
                strokeDasharray="4 4"
                strokeLinecap="round"
              />
              <path
                d={path}
                fill="none"
                stroke="#F5AF28"
                strokeWidth="2.5"
                strokeOpacity="0.6"
              />

              {/* Interchange Station Pill */}
              <g transform={`translate(${curveX2}, ${curveY2})`}>
                <circle cx="0" cy="0" r="10" fill="#0C0A07" stroke="#F5AF28" strokeWidth="3" />
                <circle cx="0" cy="0" r="5" fill="#FFD15C" />
              </g>

              {/* Conflict Signal (Red Pulsing Lantern) */}
              {j.hasConflict && (
                <g transform={`translate(${curveX1 + 20}, ${(curveY1 + curveY2) / 2})`}>
                  {/* Outer ripple */}
                  <circle
                    cx="0"
                    cy="0"
                    r="12"
                    fill="none"
                    stroke="#E06D53"
                    strokeWidth="2"
                    opacity="0.8"
                    style={{
                      animation: 'metroSignalPing 1.5s cubic-bezier(0, 0, 0.2, 1) infinite'
                    }}
                  />
                  {/* Glowing Signal Light */}
                  <circle
                    cx="0"
                    cy="0"
                    r="6"
                    fill="#FF4D4D"
                    filter="url(#signalPulse)"
                  />
                  {/* Signal Mast */}
                  <rect x="-8" y="-18" width="16" height="8" rx="2" fill="#14110C" stroke="#E06D53" strokeWidth="1" />
                  <text
                    x="0"
                    y="-12"
                    textAnchor="middle"
                    fill="#FF8A65"
                    fontSize="7"
                    fontWeight="700"
                    letterSpacing="0.5"
                  >
                    SIGNAL
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* 2. LAYER: Redirect Track Switches */}
        {redirects.map((r) => {
          const switchPath = `M ${r.x} ${r.y} Q ${r.x + 25} ${r.y}, ${r.x + 50} ${r.targetY} L ${r.x + 110} ${r.targetY}`;
          return (
            <g key={r.id} className="metro-switch">
              {/* Diverging Track Line */}
              <path
                d={switchPath}
                fill="none"
                stroke="#0C0A07"
                strokeWidth="10"
                strokeLinecap="round"
              />
              <path
                d={switchPath}
                fill="none"
                stroke="#FFD15C"
                strokeWidth="3.5"
                strokeDasharray="6 3"
                strokeLinecap="round"
              />

              {/* Track Switch Rail Lever */}
              <circle cx={r.x + 10} cy={r.y} r="4" fill="#FFD15C" stroke="#0C0A07" strokeWidth="1.5" />

              {/* Switch Direction Badge */}
              <g transform={`translate(${r.x + 50}, ${r.targetY - 14})`}>
                <rect
                  x="0"
                  y="0"
                  width="130"
                  height="20"
                  rx="4"
                  fill="#1B1710"
                  stroke="#FFD15C"
                  strokeWidth="1.2"
                />
                <text
                  x="8"
                  y="13"
                  fill="#FFD15C"
                  fontSize="9"
                  fontWeight="700"
                  letterSpacing="0.5"
                >
                  {r.label}
                </text>
              </g>
            </g>
          );
        })}

        {/* 3. LAYER: Primary Agent Metro Lines */}
        {lines.map((line) => {
          const isSelected = selectedId === line.agent.id;

          return (
            <g key={line.agent.id} className="metro-agent-line">
              {/* Dark casing around track for contrast */}
              <path
                d={line.pathD}
                fill="none"
                stroke="#0C0A07"
                strokeWidth="14"
                strokeLinecap="round"
              />

              {/* Main Colored Subway Track */}
              <path
                d={line.pathD}
                fill="none"
                stroke={line.color.main}
                strokeWidth={line.isGod ? "8" : "6"}
                strokeLinecap="round"
                opacity={isSelected ? 1 : 0.85}
                filter={isSelected ? 'url(#amberGlow)' : undefined}
              />

              {/* Track Center Line Rail */}
              <path
                d={line.pathD}
                fill="none"
                stroke="#0C0A07"
                strokeWidth="1.5"
                strokeDasharray="8 6"
                opacity="0.6"
              />

              {/* Terminus Station (Left End Cap) */}
              <g
                className="interactive-node"
                style={{ cursor: 'pointer' }}
                onClick={() => select(line.agent.id)}
                transform={`translate(60, ${line.y})`}
              >
                {/* Terminus Cap */}
                <rect
                  x="-10"
                  y="-22"
                  width="135"
                  height="44"
                  rx="6"
                  fill="#14110C"
                  stroke={isSelected ? line.color.bright : '#2A2417'}
                  strokeWidth={isSelected ? 2 : 1}
                />
                {/* Color Accent Bar */}
                <rect
                  x="-10"
                  y="-22"
                  width="6"
                  height="44"
                  rx="3"
                  fill={line.color.main}
                />

                {/* Line Terminus Label */}
                <text
                  x="6"
                  y="-4"
                  fill="#F5EDD8"
                  fontSize="12"
                  fontWeight="700"
                >
                  {line.agent.name.toUpperCase()}
                </text>
                <text
                  x="6"
                  y="12"
                  fill={line.color.bright}
                  fontSize="9.5"
                  fontWeight="600"
                >
                  {line.isGod ? 'LEAD TRUNK LINE' : (line.agent.description || 'AGENT LINE').toUpperCase()}
                </text>

                {/* Live Status indicator */}
                <circle
                  cx="112"
                  cy="0"
                  r="5"
                  fill={line.isWorking ? line.color.bright : '#7A7263'}
                  stroke="#0C0A07"
                  strokeWidth="1.5"
                />
              </g>

              {/* 4. LAYER: Stations along the Line */}
              {line.stations.map((st, sIndex) => {
                const isStationSelected = selectedStation?.task.id === st.task.id;
                const status = st.task.status;
                const isDoing = status === 'doing';
                const isBlocked = status === 'blocked';
                const isDone = status === 'done';

                return (
                  <g
                    key={st.task.id}
                    className="interactive-node"
                    transform={`translate(${st.x}, ${st.y})`}
                    style={{ cursor: 'pointer' }}
                    onClick={() => handleStationClick(st)}
                  >
                    {/* Hover hit-box */}
                    <circle cx="0" cy="0" r="28" fill="transparent" />

                    {/* Doing / Active Station Ripple */}
                    {isDoing && (
                      <circle
                        cx="0"
                        cy="0"
                        r="18"
                        fill="none"
                        stroke={line.color.bright}
                        strokeWidth="2"
                        opacity="0.8"
                        style={{
                          animation: 'metroStationPulse 2s ease-out infinite'
                        }}
                      />
                    )}

                    {/* Station Node Graphic */}
                    {/* Outer ring */}
                    <circle
                      cx="0"
                      cy="0"
                      r={isStationSelected ? 12 : 9.5}
                      fill="#14110C"
                      stroke={isBlocked ? '#E06D53' : isDone ? '#48B57D' : line.color.main}
                      strokeWidth={isStationSelected ? 3.5 : 2.5}
                      filter={isStationSelected ? 'url(#amberGlow)' : undefined}
                    />

                    {/* Inner core */}
                    <circle
                      cx="0"
                      cy="0"
                      r={isDone ? 6 : isDoing ? 5 : 3.5}
                      fill={isBlocked ? '#E06D53' : isDone ? '#48B57D' : isDoing ? line.color.bright : '#1B1710'}
                    />

                    {/* Checkmark inside done station */}
                    {isDone && (
                      <path
                        d="M -3 0 L -1 2 L 3 -2"
                        fill="none"
                        stroke="#0C0A07"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    )}

                    {/* Station Name Label */}
                    <g transform={`translate(0, ${sIndex % 2 === 0 ? 24 : -24})`}>
                      {/* Label Background pill */}
                      <rect
                        x="-70"
                        y={sIndex % 2 === 0 ? "0" : "-20"}
                        width="140"
                        height="20"
                        rx="4"
                        fill="#14110C"
                        stroke={isStationSelected ? line.color.bright : '#2A2417'}
                        strokeWidth="1"
                        opacity="0.9"
                      />
                      {/* Station Title */}
                      <text
                        x="0"
                        y={sIndex % 2 === 0 ? "13" : "-7"}
                        textAnchor="middle"
                        fill={isStationSelected ? line.color.bright : '#F5EDD8'}
                        fontSize="10"
                        fontWeight={isStationSelected ? '700' : '500'}
                      >
                        {st.task.title.length > 20
                          ? `${st.task.title.slice(0, 18)}…`
                          : st.task.title}
                      </text>
                    </g>
                  </g>
                );
              })}

              {/* 5. LAYER: Animated Glowing Train (For working agents) */}
              {line.isWorking && line.stations.length > 0 && (() => {
                const firstX = line.stations[0].x;
                const lastX = line.stations[line.stations.length - 1].x + 80;
                const trackLen = Math.max(lastX - firstX, 100);
                // Ping-pong or continuous glide along track
                const trainOffset = firstX + ((trainTime * 2) % 2 > 1 ? (2 - (trainTime * 2 % 2)) : (trainTime * 2 % 2)) * trackLen;

                return (
                  <g
                    key={`train-${line.agent.id}`}
                    transform={`translate(${trainOffset}, ${line.y})`}
                    filter="url(#trainGlow)"
                    style={{ pointerEvents: 'none' }}
                  >
                    {/* Headlight beam */}
                    <polygon
                      points="18,-5 90,-22 90,22 18,5"
                      fill="url(#headlightBeam)"
                    />

                    {/* Glowing Engine Capsule */}
                    <rect
                      x="-20"
                      y="-8"
                      width="40"
                      height="16"
                      rx="8"
                      fill={line.color.bright}
                      stroke="#FFFFFF"
                      strokeWidth="1.5"
                    />

                    {/* Train Cabin Windows */}
                    <rect x="-12" y="-3.5" width="8" height="7" rx="2" fill="#0C0A07" />
                    <rect x="0" y="-3.5" width="8" height="7" rx="2" fill="#0C0A07" />

                    {/* Front Headlight Core */}
                    <circle cx="18" cy="0" r="3" fill="#FFFFFF" />
                  </g>
                );
              })()}
            </g>
          );
        })}
      </svg>

      {/* TOP HUD: Metro Transit Bar */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          right: 16,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          pointerEvents: 'none'
        }}
      >
        <div
          style={{
            pointerEvents: 'auto',
            background: 'rgba(20, 17, 12, 0.92)',
            backdropFilter: 'blur(8px)',
            border: '1px solid #2A2417',
            borderRadius: 6,
            padding: '8px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: '#F5AF28',
                boxShadow: '0 0 10px #F5AF28'
              }}
            />
            <span style={{ fontSize: 13, fontWeight: 700, color: '#F5EDD8', letterSpacing: '0.5px' }}>
              CONCLAVE TRANSIT NETWORK
            </span>
            <span style={{ fontSize: 10, background: '#2A1F0B', color: '#FFD15C', padding: '2px 6px', borderRadius: 3, fontWeight: 700 }}>
              BRANCH METRO
            </span>
          </div>

          <div style={{ width: 1, height: 18, background: '#2A2417' }} />

          <div style={{ display: 'flex', gap: 14, fontSize: 11, color: '#D8CEB8' }}>
            <span>Lines: <strong style={{ color: '#FFD15C' }}>{lines.length}</strong></span>
            <span>Stations: <strong style={{ color: '#F5EDD8' }}>{tasks.length}</strong></span>
            <span>Active Trains: <strong style={{ color: '#48B57D' }}>{lines.filter((l) => l.isWorking).length}</strong></span>
            {junctions.some((j) => j.hasConflict) && (
              <span style={{ color: '#FF8A65', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#FF4D4D' }} />
                Conflict Signals Active
              </span>
            )}
          </div>
        </div>

        {/* Legend Overlay */}
        <div
          style={{
            pointerEvents: 'auto',
            background: 'rgba(20, 17, 12, 0.92)',
            backdropFilter: 'blur(8px)',
            border: '1px solid #2A2417',
            borderRadius: 6,
            padding: '6px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontSize: 10,
            color: '#9E937D'
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 12, height: 3, background: '#F5AF28', borderRadius: 1 }} /> Agent Line
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', border: '2px solid #F5AF28' }} /> Station (Task)
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#0C0A07', border: '2px solid #FFD15C' }} /> Junction (Merge)
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#FF4D4D' }} /> Conflict Signal
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 12, height: 6, borderRadius: 3, background: '#FFD15C' }} /> Train (Working)
          </span>
        </div>
      </div>

      {/* BOTTOM RIGHT: Zoom & Navigation Controls */}
      <div
        style={{
          position: 'absolute',
          bottom: 20,
          right: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          background: 'rgba(20, 17, 12, 0.95)',
          border: '1px solid #2A2417',
          borderRadius: 6,
          padding: 4,
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.6)'
        }}
      >
        <button
          onClick={() => setZoom((z) => Math.min(z + 0.15, 2.2))}
          title="Zoom In"
          style={{
            width: 32,
            height: 32,
            background: '#1B1710',
            border: '1px solid #2A2417',
            color: '#F5EDD8',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 16,
            fontWeight: 700
          }}
        >
          +
        </button>
        <button
          onClick={() => setZoom((z) => Math.max(z - 0.15, 0.4))}
          title="Zoom Out"
          style={{
            width: 32,
            height: 32,
            background: '#1B1710',
            border: '1px solid #2A2417',
            color: '#F5EDD8',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 16,
            fontWeight: 700
          }}
        >
          −
        </button>
        <button
          onClick={() => { setZoom(1); setPan({ x: 40, y: 40 }); }}
          title="Reset View"
          style={{
            width: 32,
            height: 32,
            background: '#1B1710',
            border: '1px solid #2A2417',
            color: '#FFD15C',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 10,
            fontWeight: 700
          }}
        >
          FIT
        </button>
      </div>

      {/* SELECTED STATION CARD OVERLAY (Direct Click Inspector) */}
      {selectedStation && (
        <div
          style={{
            position: 'absolute',
            bottom: 20,
            left: 20,
            width: 340,
            background: '#14110C',
            border: '1px solid #F5AF28',
            borderRadius: 8,
            padding: 16,
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.75)',
            zIndex: 10
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: '#FFD15C', letterSpacing: '0.8px', marginBottom: 2 }}>
                STATION INSPECTOR · {selectedStation.task.id.toUpperCase()}
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#F5EDD8' }}>
                {selectedStation.task.title}
              </div>
            </div>
            <button
              onClick={() => setSelectedStation(null)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#9E937D',
                cursor: 'pointer',
                fontSize: 16,
                padding: '0 4px'
              }}
            >
              ✕
            </button>
          </div>

          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: '2px 6px',
                borderRadius: 3,
                background:
                  selectedStation.task.status === 'done'
                    ? '#162E21'
                    : selectedStation.task.status === 'doing'
                    ? '#2A1F0B'
                    : selectedStation.task.status === 'blocked'
                    ? '#321B17'
                    : '#1B1710',
                color:
                  selectedStation.task.status === 'done'
                    ? '#48B57D'
                    : selectedStation.task.status === 'doing'
                    ? '#FFD15C'
                    : selectedStation.task.status === 'blocked'
                    ? '#FF8A65'
                    : '#D8CEB8'
              }}
            >
              {selectedStation.task.status.toUpperCase()}
            </span>
            {selectedStation.agentId && (
              <span style={{ fontSize: 10, color: '#9E937D', alignSelf: 'center' }}>
                Line: <strong style={{ color: '#F5EDD8' }}>{agents.find((a) => a.id === selectedStation.agentId)?.name ?? selectedStation.agentId}</strong>
              </span>
            )}
          </div>

          {/* Action Buttons for Chat and Changes */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => {
                if (selectedStation.agentId) select(selectedStation.agentId);
                setSidebarTab('terminal');
              }}
              style={{
                flex: 1,
                padding: '8px 10px',
                background: '#F5AF28',
                border: 'none',
                borderRadius: 4,
                color: '#0C0A07',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                textAlign: 'center'
              }}
            >
              Open Terminal / Chat
            </button>
            <button
              onClick={() => {
                if (selectedStation.agentId) select(selectedStation.agentId);
                setSidebarTab('git');
              }}
              style={{
                flex: 1,
                padding: '8px 10px',
                background: '#1B1710',
                border: '1px solid #2A2417',
                borderRadius: 4,
                color: '#FFD15C',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                textAlign: 'center'
              }}
            >
              View Changes (Git)
            </button>
          </div>
        </div>
      )}

      {/* Global CSS animations for subway signals & stations */}
      <style>{`
        @keyframes metroSignalPing {
          0% { r: 6px; opacity: 1; }
          100% { r: 18px; opacity: 0; }
        }
        @keyframes metroStationPulse {
          0% { r: 10px; opacity: 0.9; }
          100% { r: 24px; opacity: 0; }
        }
      `}</style>
    </div>
  );
}
