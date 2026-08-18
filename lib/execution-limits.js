export const NODE_MEMORY_OPTIONS_MB = [256, 384, 512, 640, 768, 1024, 1536, 2048];

export const MAX_NODE_MEMORY_MB = NODE_MEMORY_OPTIONS_MB.at(-1);
export const MAX_PARALLEL_EXECUTIONS = 5;
export const MAX_COMBINED_NODE_MEMORY_MB = 4096;

export function maximumNodeMemoryForParallelExecutions(parallelExecutions) {
  const perExecutionBudget = Math.floor(MAX_COMBINED_NODE_MEMORY_MB / parallelExecutions);
  return NODE_MEMORY_OPTIONS_MB.findLast((memoryMb) => memoryMb <= perExecutionBudget);
}
