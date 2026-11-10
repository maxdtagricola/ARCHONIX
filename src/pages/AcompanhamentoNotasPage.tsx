import { deleteNotaFiscal, listNotasFiscais, saveNotaFiscal, updateNotaFiscalStatus } from '../db/notasFiscaisRepo'
import { RegistroNotasPage, type ConfigRegistroNotas } from './RegistroNotasPage'

// "Transferências Fiscais" — a tela em si é a mesma de Notas Fiscais (ver RegistroNotasPage), só
// muda a coleção no servidor e os títulos. O prefixo "notas" mantém os rascunhos já salvos.
const CONFIG_TRANSFERENCIAS: ConfigRegistroNotas = {
  prefixoChave: 'notas',
  tituloRegistro: 'Registro de Transferências',
  tituloLista: 'Transferências fiscais registradas',
  listar: listNotasFiscais,
  salvar: saveNotaFiscal,
  atualizarStatus: updateNotaFiscalStatus,
  excluir: deleteNotaFiscal,
  // faturado / parado no estoque — alimenta o gráfico de faturamento × prejuízo do Dashboard de Transferências
  controleResultado: true,
}

// sem administrador, nada de faturado / prejuízo (o resultado já marcado continua na nota, só não aparece)
const CONFIG_TRANSFERENCIAS_SEM_RESULTADO: ConfigRegistroNotas = { ...CONFIG_TRANSFERENCIAS, controleResultado: false }

export function AcompanhamentoNotasPage({ currentAdmin, veFinanceiro }: { currentAdmin: string; veFinanceiro: boolean }) {
  return <RegistroNotasPage currentAdmin={currentAdmin} config={veFinanceiro ? CONFIG_TRANSFERENCIAS : CONFIG_TRANSFERENCIAS_SEM_RESULTADO} />
}
