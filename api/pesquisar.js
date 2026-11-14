
const NOMINATIM = "https://nominatim.openstreetmap.org";
const OVERPASS = "https://overpass-api.de/api/interpreter";

const USER_AGENT = "MenteDigital/1.0 (contato: configure seu email)";

const NICHOS = {
  restaurantes: ['amenity=restaurant'],
  hamburguerias: ['amenity=fast_food'],
  barbearias: ['shop=hairdresser'],
  saloes: ['shop=beauty'],
  clinicas: ['amenity=clinic'],
  dentistas: ['amenity=dentist'],
  imobiliarias: ['office=estate_agent'],
  academias: ['leisure=fitness_centre'],
  oficinas: ['shop=car_repair'],
  lojas: ['shop=*'],
  advocacia: ['office=lawyer'],
  assistencia_tecnica: ['shop=electronics']
};

function resposta(res, status, dados) {
  return res.status(status).json(dados);
}

function texto(valor, limite = 100) {
  return typeof valor === "string"
    ? valor.trim().slice(0, limite)
    : "";
}

function classificar(tags = {}) {
  if (tags.amenity === "restaurant") return "Restaurante";
  if (tags.amenity === "fast_food") return "Hamburgueria";
  if (tags.shop === "hairdresser") return "Barbearia / Cabeleireiro";
  if (tags.shop === "beauty") return "Salão de beleza";
  if (tags.amenity === "clinic") return "Clínica";
  if (tags.amenity === "dentist") return "Dentista";
  if (tags.office === "estate_agent") return "Imobiliária";
  if (tags.leisure === "fitness_centre") return "Academia";
  if (tags.shop === "car_repair") return "Oficina";
  if (tags.office === "lawyer") return "Advocacia";
  if (tags.shop === "electronics") return "Loja de eletrônicos";
  return tags.shop || tags.office || tags.amenity || "Estabelecimento";
}

function montarLead(elemento) {
  const tags = elemento.tags || {};
  const nome = texto(tags.name);

  if (!nome) return null;

  const endereco = [
    tags["addr:street"],
    tags["addr:housenumber"],
    tags["addr:suburb"]
  ].filter(Boolean).join(", ");

  const cidade = texto(tags["addr:city"]);

  const site = texto(tags.website || tags["contact:website"], 300);

  return {
    nome,
    nicho: classificar(tags),
    endereco,
    cidade,
    telefone: texto(tags.phone || tags["contact:phone"]),
    whatsapp: texto(tags["contact:whatsapp"]),
    instagram: texto(tags["contact:instagram"]),
    site,
    status: site ? "Verificação pendente" : "Site não localizado",
    evidencia: site
      ? "A fonte informa um endereço de site, ainda não verificado."
      : "A fonte consultada não informa um site. Isso não confirma sua ausência.",
    fonteUrl: `https://www.openstreetmap.org/${elemento.type}/${elemento.id}`
  };
}

async function buscarArea(cidade, estado, pais) {
  const consulta = [cidade, estado, pais]
    .filter(Boolean)
    .join(", ");

  const url = new URL(`${NOMINATIM}/search`);

  url.searchParams.set("q", consulta);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");

  const respostaApi = await fetch(url, {
    headers: { "User-Agent": USER_AGENT }
  });

  if (!respostaApi.ok) {
    throw new Error("Falha ao consultar a localização.");
  }

  const resultados = await respostaApi.json();

  if (!resultados.length) return null;

  return resultados[0];
}

async function buscarEstabelecimentos(area, nichos, quantidade) {
  const latitude = Number(area.lat);
  const longitude = Number(area.lon);

  const raio = 12000;

  const filtros = [];

  for (const nicho of nichos) {
    const regras = NICHOS[nicho];

    if (!regras) continue;

    for (const regra of regras) {
      const [chave, valor] = regra.split("=");

      const filtro = valor === "*"
        ? `["${chave}"]`
        : `["${chave}"="${valor}"]`;

      filtros.push(
        `node(around:${raio},${latitude},${longitude})${filtro};`,
        `way(around:${raio},${latitude},${longitude})${filtro};`
      );
    }
  }

  if (!filtros.length) {
    return [];
  }

  const consulta = `
    [out:json][timeout:25];
    (
      ${filtros.join("\n")}
    );
    out center tags ${Math.min(quantidade, 100)};
  `;

  const respostaApi = await fetch(OVERPASS, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT
    },
    body: `data=${encodeURIComponent(consulta)}`
  });

  if (!respostaApi.ok) {
    throw new Error("Falha na consulta de estabelecimentos.");
  }

  const dados = await respostaApi.json();

  return (dados.elements || [])
    .map(montarLead)
    .filter(Boolean)
    .slice(0, quantidade);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return resposta(res, 405, {
      erro: "Método não permitido. Utilize POST."
    });
  }

  try {
    const corpo = req.body || {};

    const cidade = texto(corpo.cidade || corpo.cidades?.[0], 100);
    const estado = texto(corpo.estado, 100);
    const pais = texto(corpo.pais || "Brasil", 100);

    const nichos = Array.isArray(corpo.nichos)
      ? corpo.nichos.filter(n => typeof n === "string")
      : [];

    const quantidade = Math.max(
      1,
      Math.min(Number(corpo.quantidade) || 20, 100)
    );

    if (!cidade) {
      return resposta(res, 400, {
        erro: "Informe uma cidade para pesquisar."
      });
    }

    if (!nichos.length) {
      return resposta(res, 400, {
        erro: "Selecione pelo menos um nicho."
      });
    }

    const area = await buscarArea(cidade, estado, pais);

    if (!area) {
      return resposta(res, 404, {
        erro: "Localização não encontrada.",
        leads: []
      });
    }

    const leads = await buscarEstabelecimentos(
      area,
      nichos,
      quantidade
    );

    return resposta(res, 200, {
      sucesso: true,
      fonte: "OpenStreetMap",
      pesquisadoEm: new Date().toISOString(),
      total: leads.length,
      leads,
      aviso: "A ausência de site na fonte não confirma que a empresa não possui site."
    });

  } catch (erro) {
    console.error("Erro na pesquisa:", erro);

    return resposta(res, 500, {
      erro: "Não foi possível concluir a pesquisa.",
      leads: []
    });
  }
};
