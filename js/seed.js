// Categorías y reglas de partida. Se cargan una sola vez al crear el hogar.
// Las reglas usan "Categoría › Subcategoría". Prefijos de patrón: '=' exacto, '^' empieza por; sin prefijo, contiene.

export const SEED_CATEGORIES = {
  gasto: {
    'Vivienda': ['Comunidad', 'Mantenimiento y reparaciones', 'Hogar y muebles', 'Bricolaje'],
    'Piso alquiler': ['Comunidad y derramas', 'Seguro', 'Suministros', 'Mantenimiento', 'Impuestos'],
    'Suministros': ['Luz', 'Agua', 'Gas', 'Internet y móvil'],
    'Alimentación': ['Supermercado', 'Frutería y mercado', 'Panadería y dulces'],
    'Restauración': ['Restaurantes', 'Cafeterías', 'Comida a domicilio', 'Vending'],
    'Transporte': ['Combustible', 'Mantenimiento vehículo', 'ITV e impuestos vehículo', 'Aparcamiento', 'Transporte público'],
    'Caravana': ['Camping', 'Mantenimiento', 'Equipamiento'],
    'Deudas': ['Hipoteca', 'Caravana (cuota)', 'Cocina Ikea', 'Aplazamiento Hacienda', 'Tarjeta de crédito'],
    'Hija': ['Ropa', 'Ocio', 'Juguetes', 'Otros'],
    'Educación': ['Colegio', 'Idiomas', 'Extraescolares', 'Material'],
    'Salud': ['Farmacia', 'Consultas', 'Dentista', 'Óptica'],
    'Seguros': ['Hogar', 'Coche', 'Vida y decesos', 'Salud', 'Otros seguros'],
    'Compras': ['Ropa', 'Tecnología', 'Libros', 'Compras online', 'Otros'],
    'Suscripciones': ['Streaming', 'Apple', 'Google', 'Software', 'Banca'],
    'Ocio y deporte': ['Gimnasio', 'Actividades', 'Cultura', 'Escapadas'],
    'Viajes': ['Transporte', 'Alojamiento', 'Gastos en destino'],
    'Profesional': ['Colegiación', 'Formación', 'Material'],
    'Impuestos y tasas': ['IBI y tributos locales', 'Tributos autonómicos', 'IRPF', 'Multas'],
    'Regalos': ['Cumpleaños', 'Fiestas'],
    'Otros gastos': ['Varios', 'Comisiones bancarias'],
  },
  ingreso: {
    'Ingresos': ['Nómina', 'Formación y docencia', 'Alquiler', 'Devoluciones y reembolsos', 'Otros ingresos'],
  },
};

// [patrón, comercio, tipo, 'Categoría › Sub' | null, {bank, sign, priority}]
export const SEED_RULES = [
  // Movimientos entre cuentas propias (no son gasto)
  ['compra revolut**', 'Recarga Revolut', 'interna', null, { bank: 'santander' }],
  ['recarga de apple pay', 'Recarga desde Santander', 'interna', null, { bank: 'revolut', sign: '+' }],
  ['^al pocket', 'Pocket Colchón', 'ahorro', null, { bank: 'revolut' }],
  ['^retirada del pocket', 'Pocket Colchón', 'ahorro', null, { bank: 'revolut' }],
  ['traspaso desde cuenta hipoteca', 'Traspaso para la hipoteca', 'aportacion', null, { bank: 'bbva', sign: '+', priority: 12 }],
  ['traspaso desde cuenta', 'Traspaso recibido', 'aportacion', null, { bank: 'bbva', sign: '+' }],
  ['traspaso a cuenta', 'Traspaso enviado', 'interna', null, { bank: 'bbva', sign: '-' }],

  // Ingresos
  ['gestion de servicios salud y seguridad', 'Nómina GSC', 'ingreso', 'Ingresos › Nómina', { sign: '+' }],
  ['brokair', 'Brok-air', 'ingreso', 'Ingresos › Formación y docencia', { sign: '+' }],
  ['stripe payments', 'Reembolso Stripe', 'ingreso', 'Ingresos › Devoluciones y reembolsos', { sign: '+' }],
  ['ingreso en cajero', 'Ingreso en efectivo', 'ingreso', 'Ingresos › Otros ingresos', { sign: '+' }],

  // Deudas
  ['liquidacion periodica prestamo', 'Préstamo caravana', 'gasto', 'Deudas › Caravana (cuota)', { bank: 'santander' }],
  ['cargo por amortizacion de prestamo', 'Hipoteca', 'gasto', 'Deudas › Hipoteca', { bank: 'bbva' }],
  ['santander consumer finance', 'Financiación cocina Ikea', 'gasto', 'Deudas › Cocina Ikea', {}],
  ['agencia tributaria canaria', 'Aplazamiento Agencia Tributaria Canaria', 'gasto', 'Deudas › Aplazamiento Hacienda', {}],
  ['liquidacion de las tarjetas de credito', 'Tarjeta de crédito Santander', 'gasto', 'Deudas › Tarjeta de crédito', {}],

  // Piso de alquiler
  ['fincas', 'Administrador de fincas', 'gasto', 'Piso alquiler › Comunidad y derramas', { priority: 12 }],
  ['axa seguros', 'AXA', 'gasto', 'Piso alquiler › Seguro', {}],

  // Vivienda y suministros
  ['endesa', 'Endesa', 'gasto', 'Suministros › Luz', {}],
  ['pepe mobile', 'Pepe Mobile', 'gasto', 'Suministros › Internet y móvil', {}],

  // Impuestos
  ['consorcio de tributos', 'Consorcio de Tributos', 'gasto', 'Impuestos y tasas › IBI y tributos locales', {}],
  ['comunidad autonoma de canarias', 'Comunidad Autónoma de Canarias', 'gasto', 'Impuestos y tasas › Tributos autonómicos', {}],

  // Seguros
  ['mutua madrilena', 'Mutua Madrileña', 'gasto', 'Seguros › Coche', {}],
  ['allianz', 'BBVA Allianz', 'gasto', 'Seguros › Hogar', {}],
  ['agrupacion mutual asegurador', 'A.M.A.', 'gasto', 'Seguros › Otros seguros', {}],
  ['dkv', 'DKV', 'gasto', 'Seguros › Vida y decesos', {}],
  ['domestic and general', 'Domestic & General', 'gasto', 'Seguros › Otros seguros', {}],

  // Educación, deporte, profesional
  ['ise language school', 'ISE Language School', 'gasto', 'Educación › Idiomas', {}],
  ['ceip', 'Colegio', 'gasto', 'Educación › Colegio', {}],
  ['gymoo', 'Gymoo', 'gasto', 'Ocio y deporte › Gimnasio', {}],
  ['colegio oficial de enfermeros', 'Colegio de Enfermería', 'gasto', 'Profesional › Colegiación', {}],

  // Suscripciones
  ['ring llc', 'Ring', 'gasto', 'Suscripciones › Software', {}],
  ['canva', 'Canva', 'gasto', 'Suscripciones › Software', {}],
  ['itunes', 'Apple', 'gasto', 'Suscripciones › Apple', {}],
  ['paypal *google', 'Google', 'gasto', 'Suscripciones › Google', {}],
  ['google cloud', 'Google Cloud', 'gasto', 'Suscripciones › Google', {}],
  ['anthropic', 'Claude', 'gasto', 'Suscripciones › Software', {}],
  ['=claude', 'Claude', 'gasto', 'Suscripciones › Software', {}],
  ['webempresa', 'Webempresa', 'gasto', 'Suscripciones › Software', {}],
  ['tarifa del plan', 'Revolut Premium', 'gasto', 'Suscripciones › Banca', { bank: 'revolut' }],

  // Alimentación
  ['mercadona', 'Mercadona', 'gasto', 'Alimentación › Supermercado', {}],
  ['hiperdino', 'HiperDino', 'gasto', 'Alimentación › Supermercado', {}],
  ['superdino', 'HiperDino', 'gasto', 'Alimentación › Supermercado', {}],
  ['lidl', 'Lidl', 'gasto', 'Alimentación › Supermercado', {}],
  ['aldi', 'Aldi', 'gasto', 'Alimentación › Supermercado', {}],
  ['alcampo', 'Alcampo', 'gasto', 'Alimentación › Supermercado', {}],
  ['spar ', 'Spar', 'gasto', 'Alimentación › Supermercado', {}],
  ['carrefour', 'Carrefour', 'gasto', 'Alimentación › Supermercado', {}],
  ['azucar y mas', 'Azúcar y Más', 'gasto', 'Alimentación › Panadería y dulces', {}],

  // Transporte
  ['gm oil', 'GM Oil', 'gasto', 'Transporte › Combustible', {}],
  ['disa', 'DISA', 'gasto', 'Transporte › Combustible', {}],
  ['shell', 'Shell', 'gasto', 'Transporte › Combustible', {}],
  ['cepsa', 'Cepsa', 'gasto', 'Transporte › Combustible', {}],
  ['=bp', 'BP', 'gasto', 'Transporte › Combustible', {}],
  ['e.s. ', 'Estación de servicio', 'gasto', 'Transporte › Combustible', {}],
  ['estacion tf', 'Estación de servicio', 'gasto', 'Transporte › Combustible', {}],
  ['park ', 'Aparcamiento', 'gasto', 'Transporte › Aparcamiento', {}],
  ['estacionam', 'Aparcamiento', 'gasto', 'Transporte › Aparcamiento', {}],
  ['aparcamiento', 'Aparcamiento', 'gasto', 'Transporte › Aparcamiento', {}],
  ['titsa', 'TITSA', 'gasto', 'Transporte › Transporte público', {}],

  // Restauración
  ['glovo', 'Glovo', 'gasto', 'Restauración › Comida a domicilio', {}],
  ['just eat', 'Just Eat', 'gasto', 'Restauración › Comida a domicilio', {}],
  ['taco bell', 'Taco Bell', 'gasto', 'Restauración › Restaurantes', {}],
  ['mcdonald', "McDonald's", 'gasto', 'Restauración › Restaurantes', {}],
  ['burger king', 'Burger King', 'gasto', 'Restauración › Restaurantes', {}],
  ['cafeteria', 'Cafetería', 'gasto', 'Restauración › Cafeterías', {}],
  ['medirest', 'Medirest', 'gasto', 'Restauración › Cafeterías', {}],
  ['vending', 'Vending', 'gasto', 'Restauración › Vending', {}],
  ['orain', 'Vending Orain', 'gasto', 'Restauración › Vending', {}],

  // Compras y hogar
  ['ikea', 'Ikea', 'gasto', 'Vivienda › Hogar y muebles', {}],
  ['el corte ingles', 'El Corte Inglés', 'gasto', 'Compras › Otros', {}],
  ['amazon', 'Amazon', 'gasto', 'Compras › Compras online', {}],
  ['agapea', 'Agapea', 'gasto', 'Compras › Libros', {}],
  ['libreria', 'Librería', 'gasto', 'Compras › Libros', {}],
  ['ferreteria', 'Ferretería', 'gasto', 'Vivienda › Bricolaje', {}],
  ['pinturas', 'Pinturas', 'gasto', 'Vivienda › Bricolaje', {}],
  ['farmacia', 'Farmacia', 'gasto', 'Salud › Farmacia', {}],
  ['groupon', 'Groupon', 'gasto', 'Ocio y deporte › Actividades', {}],
];
