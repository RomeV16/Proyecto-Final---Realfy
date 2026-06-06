import { useTranslations } from 'next-intl';

interface MockProperty {
  id: string;
  address: string;
  type: string;
  state: 'Disponible' | 'Reservado' | 'Alquilado' | 'Vendido';
  price: string;
}

/**
 * Datos de muestra (mock) para el listado de propiedades. Se reemplazan por
 * datos reales de la API en items posteriores.
 */
const MOCK_PROPERTIES: MockProperty[] = [
  {
    id: '1',
    address: 'Av. Santa Fe 1234, 5° B',
    type: 'Departamento',
    state: 'Disponible',
    price: 'USD 145.000',
  },
  {
    id: '2',
    address: 'Calle Mendoza 567',
    type: 'Casa',
    state: 'Reservado',
    price: 'USD 320.000',
  },
  {
    id: '3',
    address: 'Belgrano 890, Local 2',
    type: 'Local',
    state: 'Alquilado',
    price: 'ARS 450.000 / mes',
  },
  {
    id: '4',
    address: 'Ruta 8 Km 45, Lote 12',
    type: 'Terreno',
    state: 'Vendido',
    price: 'USD 78.000',
  },
];

const STATE_STYLES: Record<MockProperty['state'], string> = {
  Disponible: 'bg-emerald-100 text-emerald-700',
  Reservado: 'bg-amber-100 text-amber-700',
  Alquilado: 'bg-sky-100 text-sky-700',
  Vendido: 'bg-slate-200 text-slate-600',
};

export default function PropiedadesPage() {
  const t = useTranslations('properties');

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MOCK_PROPERTIES.map((property) => (
          <div
            key={property.id}
            className="rounded-xl border border-slate-200 bg-white p-5"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium text-slate-900">
                {property.address}
              </p>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATE_STYLES[property.state]}`}
              >
                {property.state}
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-400">{property.type}</p>
            <p className="mt-3 text-lg font-bold tabular-nums text-slate-900">
              {property.price}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
