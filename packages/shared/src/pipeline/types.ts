export type PipelineElementKind = "source" | "transform" | "boundary" | "sink";

export type PipelineDefinition = {
  name: string;
  elements: PipelineElementDef[];
};

export type PipelineElementDef = {
  name: string;
  kind: PipelineElementKind;
  deps?: Record<string, unknown>;
};
