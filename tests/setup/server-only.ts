// Dentro do Next, `server-only` é um marcador que quebra o build se um módulo do servidor entrar no
// bundle do navegador. No Vitest (ambiente node) o pacote real lança ao ser importado; este módulo vazio
// o substitui só nos testes.
export {}
