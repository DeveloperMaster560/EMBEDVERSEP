import { createHash } from 'node:crypto';
import type { CompileResponse } from '../arduinoCompiler.js';
import { compileProject, validateCompileRequest } from '../arduinoCompiler.js';
import { assertNoCredentialMaterial } from '../../src/agent-team/security.js';

export interface FirmwareCompileEvidence {
  text: string;
  summary: string;
  evidenceRefs: string[];
}

export interface FirmwareCompiler {
  compile(boardId: string, files: { path: string; content: string }[]): Promise<FirmwareCompileEvidence>;
}

/** Adaptador al compilador Arduino ya instalado en EMBEVERSE; nunca carga firmware en una placa. */
export class LocalFirmwareCompiler implements FirmwareCompiler {
  private readonly workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  async compile(boardId: string, files: { path: string; content: string }[]): Promise<FirmwareCompileEvidence> {
    const project = validateCompileRequest({ boardId, files });
    const response: CompileResponse = await compileProject(project, this.workspaceRoot);
    const safeResult = {
      success: response.success,
      board: response.board,
      code: response.code,
      output: response.output.slice(0, 3_000),
      error: response.error,
      diagnostico: response.diagnostico,
      artifacts: response.artifacts?.map(({ name, bytes }) => ({ name, bytes })),
      bibliotecas: response.bibliotecas?.map(({ nombre, version, licencia }) => ({ nombre, version, licencia })),
      avisosLicencia: response.avisosLicencia,
    };
    assertNoCredentialMaterial(safeResult);
    const hash = createHash('sha256').update(JSON.stringify(safeResult)).digest('hex');
    return {
      text: JSON.stringify(safeResult),
      summary: response.success
        ? `Compilación satisfactoria para ${response.board}; ${response.artifacts?.length ?? 0} artefactos enumerados.`
        : `La compilación de ${response.board} falló${response.code ? ` (${response.code})` : ''}.`,
      evidenceRefs: [`firmware://compile/${boardId}#sha256=${hash}`],
    };
  }
}
