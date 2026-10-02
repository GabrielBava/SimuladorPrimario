/*
 * Configurações do simulador (editar aqui).
 *
 * whatsappEspecialista: número do especialista usado no botão "Falar no WhatsApp"
 * da página 3 do PDF. Informe com DDD, por exemplo '11987654321'.
 *
 * planosUrl: endereço do CRM que devolve os planos cadastrados em JSON
 * (uma lista ou { "planos": [...] }). Quando vazio, usa a lista "planos" abaixo.
 *
 * planos: planos cadastrados. Campos de cada plano:
 *   id             código do plano (o CRM pode enviar ?plano=<id> no link)
 *   administradora nome da administradora (igual ao da lista do simulador)
 *   nome           nome do plano exibido na seleção
 *   categoria      'imovel' ou 'veiculo'
 *   creditoMinimo  crédito mínimo (R$)
 *   prazo          prazo do grupo (meses)
 *   taxaAdm        taxa administrativa (%)
 *   fundoReserva   fundo de reserva (%)
 *   embutidoPct    lance embutido (%)
 *   fixoPct        lance fixo (%)
 *   indice         'INCC', 'IPCA', 'INPC', 'pre5', 'pre6' ou 'outro'
 *   indiceTaxa     (opcional) taxa anual estimada do índice (%)
 *
 * Os dois planos abaixo são exemplos com os valores padrão do simulador:
 * substitua pelos planos cadastrados no CRM.
 */
window.CONFIG_SIMULADOR = {
  whatsappEspecialista: '',
  planosUrl: '',
  planos: [
    { id: 'EX-IMOVEL', exemplo: true, administradora: 'HS', nome: 'Imóvel 240 meses', categoria: 'imovel', creditoMinimo: 200000, prazo: 240, taxaAdm: 20, fundoReserva: 2, embutidoPct: 25, fixoPct: 50, indice: 'INCC' },
    { id: 'EX-VEICULO', exemplo: true, administradora: 'HS', nome: 'Veículo 100 meses', categoria: 'veiculo', creditoMinimo: 80000, prazo: 100, taxaAdm: 13, fundoReserva: 2, embutidoPct: 25, fixoPct: 50, indice: 'IPCA' }
  ]
};
