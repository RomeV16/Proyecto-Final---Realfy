import { useTranslations } from 'next-intl';

type PersonRole = 'Propietario' | 'Inquilino' | 'Garante';

interface MockPerson {
  id: string;
  name: string;
  roles: PersonRole[];
  cuit: string;
}

/**
 * Datos de muestra (mock) para el listado de personas. Se reemplazan por
 * datos reales de la API en items posteriores.
 */
const MOCK_PERSONS: MockPerson[] = [
  {
    id: '1',
    name: 'María González',
    roles: ['Propietario'],
    cuit: '27-30123456-4',
  },
  {
    id: '2',
    name: 'Juan Pérez',
    roles: ['Inquilino'],
    cuit: '20-28456789-3',
  },
  {
    id: '3',
    name: 'Carla Fernández',
    roles: ['Inquilino', 'Garante'],
    cuit: '27-32987654-1',
  },
  {
    id: '4',
    name: 'Roberto Díaz',
    roles: ['Propietario', 'Garante'],
    cuit: '20-25111222-9',
  },
];

const ROLE_STYLES: Record<PersonRole, string> = {
  Propietario: 'bg-indigo-100 text-indigo-700',
  Inquilino: 'bg-sky-100 text-sky-700',
  Garante: 'bg-amber-100 text-amber-700',
};

export default function PersonasPage() {
  const t = useTranslations('persons');

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('subtitle')}</p>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase text-slate-400">
            <tr>
              <th className="px-5 py-3 font-medium">Nombre</th>
              <th className="px-5 py-3 font-medium">Roles</th>
              <th className="px-5 py-3 font-medium">CUIT</th>
            </tr>
          </thead>
          <tbody>
            {MOCK_PERSONS.map((person) => (
              <tr key={person.id} className="border-b border-slate-100 last:border-0">
                <td className="px-5 py-3 font-medium text-slate-900">
                  {person.name}
                </td>
                <td className="px-5 py-3">
                  <div className="flex flex-wrap gap-1">
                    {person.roles.map((role) => (
                      <span
                        key={role}
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_STYLES[role]}`}
                      >
                        {role}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-5 py-3 tabular-nums text-slate-500">
                  {person.cuit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
