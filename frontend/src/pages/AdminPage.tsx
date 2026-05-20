import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { fechaCorta, moneda } from '../lib/format.js';

interface Stats {
  total_empresas: number;
  total_facturas: number;
  total_usuarios: number;
  facturas_revision_humana: number;
  mes_actual: string;
  facturas_mes: number;
  total_crc_mes: number;
  procesamientos_mes: number;
}

interface UserRow {
  id: number;
  email: string;
  nombre: string;
  rol: 'admin' | 'contador';
  empresa_id: string | null;
  empresa_nombre: string | null;
  activo: number;
  ultimo_login: string | null;
  creado: string;
}

interface EmpresaRow {
  id: string;
  nombre: string;
  tipo_cedula: string;
  moneda_principal: string;
  estado: string;
  total_facturas: number;
  facturas_mes: number;
  total_crc_mes: number;
}

export function AdminPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [empresas, setEmpresas] = useState<EmpresaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  // Form nuevo usuario.
  const [showNewUser, setShowNewUser] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPwd, setNewUserPwd] = useState('');
  const [newUserNombre, setNewUserNombre] = useState('');
  const [newUserRol, setNewUserRol] = useState<'admin' | 'contador'>('contador');
  const [newUserEmpresa, setNewUserEmpresa] = useState('');
  const [creandoUser, setCreandoUser] = useState(false);

  // Form nueva empresa.
  const [showNewEmpresa, setShowNewEmpresa] = useState(false);
  const [newEmpId, setNewEmpId] = useState('');
  const [newEmpNombre, setNewEmpNombre] = useState('');
  const [newEmpTipo, setNewEmpTipo] = useState<'fisica' | 'juridica' | 'dimex' | 'nite'>('juridica');
  const [newEmpMoneda, setNewEmpMoneda] = useState<'CRC' | 'USD' | 'EUR'>('CRC');
  const [creandoEmp, setCreandoEmp] = useState(false);

  if (user && user.rol !== 'admin') {
    return (
      <div className="page">
        <div className="alert alert-error">
          Esta sección es solo para administradores.
        </div>
      </div>
    );
  }

  function recargar() {
    setLoading(true);
    setError(null);
    Promise.all([api.adminStats(), api.adminListUsers(), api.adminListEmpresas()])
      .then(([s, u, e]) => {
        setStats(s);
        setUsers(u.users);
        setEmpresas(e.empresas);
      })
      .catch((err) => setError(err instanceof ApiError ? err.humano : 'No se pudo cargar el panel.'))
      .finally(() => setLoading(false));
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    recargar();
  }, []);

  async function crearUsuario(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setExito(null);
    setError(null);
    setCreandoUser(true);
    try {
      await api.adminCreateUser({
        email: newUserEmail,
        password: newUserPwd,
        nombre: newUserNombre,
        rol: newUserRol,
        empresa_id: newUserRol === 'contador' ? newUserEmpresa : null,
      });
      setExito(`Usuario ${newUserEmail} creado.`);
      setNewUserEmail('');
      setNewUserPwd('');
      setNewUserNombre('');
      setNewUserEmpresa('');
      setShowNewUser(false);
      recargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.humano : 'No se pudo crear el usuario.');
    } finally {
      setCreandoUser(false);
    }
  }

  async function crearEmpresa(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setExito(null);
    setError(null);
    setCreandoEmp(true);
    try {
      await api.adminCreateEmpresa({
        id: newEmpId.replace(/\D/g, ''),
        nombre: newEmpNombre,
        tipo_cedula: newEmpTipo,
        moneda_principal: newEmpMoneda,
      });
      setExito(`Empresa ${newEmpNombre} creada.`);
      setNewEmpId('');
      setNewEmpNombre('');
      setShowNewEmpresa(false);
      recargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.humano : 'No se pudo crear la empresa.');
    } finally {
      setCreandoEmp(false);
    }
  }

  async function toggleUser(u: UserRow) {
    setError(null);
    try {
      await api.adminToggleUser(u.id, !u.activo);
      recargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.humano : 'No se pudo actualizar el usuario.');
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>Panel de administración</h1>
        <p className="page-subtitle">Métricas globales, usuarios y empresas cliente.</p>
      </header>

      {error && <div className="alert alert-error">{error}</div>}
      {exito && <div className="alert alert-success">{exito}</div>}

      {loading ? (
        <div className="loader-inline"><div className="loader-spinner" /> Cargando…</div>
      ) : (
        <>
          {stats && (
            <section className="card">
              <h2>Resumen — {stats.mes_actual}</h2>
              <div className="grid grid-summary">
                <div>
                  <div className="kv-label">Empresas cliente</div>
                  <div className="kv-value kv-value-lg">{stats.total_empresas}</div>
                </div>
                <div>
                  <div className="kv-label">Usuarios activos</div>
                  <div className="kv-value kv-value-lg">{stats.total_usuarios}</div>
                </div>
                <div>
                  <div className="kv-label">Facturas en sistema</div>
                  <div className="kv-value kv-value-lg">{stats.total_facturas}</div>
                </div>
                <div>
                  <div className="kv-label">Facturas del mes</div>
                  <div className="kv-value">{stats.facturas_mes}</div>
                </div>
                <div>
                  <div className="kv-label">Total CRC del mes</div>
                  <div className="kv-value">{moneda(stats.total_crc_mes, 'CRC')}</div>
                </div>
                <div>
                  <div className="kv-label">Requieren revisión</div>
                  <div className="kv-value" style={{ color: stats.facturas_revision_humana > 0 ? '#8a1c14' : undefined }}>
                    {stats.facturas_revision_humana}
                  </div>
                </div>
              </div>
            </section>
          )}

          <section className="card">
            <div className="card-header">
              <h2>Usuarios</h2>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setShowNewUser((v) => !v)}
              >
                {showNewUser ? 'Cancelar' : '+ Nuevo usuario'}
              </button>
            </div>

            {showNewUser && (
              <form className="form-grid" onSubmit={crearUsuario}>
                <label className="field">
                  <span className="field-label">Email</span>
                  <input
                    type="email"
                    value={newUserEmail}
                    onChange={(e) => setNewUserEmail(e.target.value)}
                    required
                  />
                </label>
                <label className="field">
                  <span className="field-label">Contraseña</span>
                  <input
                    type="password"
                    value={newUserPwd}
                    onChange={(e) => setNewUserPwd(e.target.value)}
                    minLength={8}
                    required
                  />
                </label>
                <label className="field">
                  <span className="field-label">Nombre</span>
                  <input
                    type="text"
                    value={newUserNombre}
                    onChange={(e) => setNewUserNombre(e.target.value)}
                    required
                  />
                </label>
                <label className="field">
                  <span className="field-label">Rol</span>
                  <select
                    value={newUserRol}
                    onChange={(e) => setNewUserRol(e.target.value as 'admin' | 'contador')}
                  >
                    <option value="contador">Contador</option>
                    <option value="admin">Administrador</option>
                  </select>
                </label>
                {newUserRol === 'contador' && (
                  <label className="field">
                    <span className="field-label">Empresa</span>
                    <select
                      value={newUserEmpresa}
                      onChange={(e) => setNewUserEmpresa(e.target.value)}
                      required
                    >
                      <option value="">Elegí una empresa…</option>
                      {empresas.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.nombre} ({e.id})
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="form-actions">
                  <button type="submit" className="btn btn-primary" disabled={creandoUser}>
                    {creandoUser ? 'Creando…' : 'Crear usuario'}
                  </button>
                </div>
              </form>
            )}

            <table className="table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Email</th>
                  <th>Rol</th>
                  <th>Empresa</th>
                  <th>Último login</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className={!u.activo ? 'row-muted' : ''}>
                    <td>{u.nombre}</td>
                    <td className="mono small">{u.email}</td>
                    <td>{u.rol}</td>
                    <td>{u.empresa_nombre ?? '—'}</td>
                    <td>{u.ultimo_login ? fechaCorta(u.ultimo_login.slice(0, 10)) : '—'}</td>
                    <td>{u.activo ? 'Activo' : 'Inactivo'}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => toggleUser(u)}
                      >
                        {u.activo ? 'Desactivar' : 'Activar'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="card">
            <div className="card-header">
              <h2>Empresas cliente</h2>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setShowNewEmpresa((v) => !v)}
              >
                {showNewEmpresa ? 'Cancelar' : '+ Nueva empresa'}
              </button>
            </div>

            {showNewEmpresa && (
              <form className="form-grid" onSubmit={crearEmpresa}>
                <label className="field">
                  <span className="field-label">Cédula (sin guiones)</span>
                  <input
                    type="text"
                    value={newEmpId}
                    onChange={(e) => setNewEmpId(e.target.value)}
                    placeholder="3006696489"
                    pattern="\d{9,12}"
                    required
                  />
                </label>
                <label className="field">
                  <span className="field-label">Nombre</span>
                  <input
                    type="text"
                    value={newEmpNombre}
                    onChange={(e) => setNewEmpNombre(e.target.value)}
                    required
                  />
                </label>
                <label className="field">
                  <span className="field-label">Tipo</span>
                  <select
                    value={newEmpTipo}
                    onChange={(e) => setNewEmpTipo(e.target.value as 'fisica' | 'juridica' | 'dimex' | 'nite')}
                  >
                    <option value="juridica">Jurídica</option>
                    <option value="fisica">Física</option>
                    <option value="dimex">DIMEX</option>
                    <option value="nite">NITE</option>
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">Moneda principal</span>
                  <select
                    value={newEmpMoneda}
                    onChange={(e) => setNewEmpMoneda(e.target.value as 'CRC' | 'USD' | 'EUR')}
                  >
                    <option value="CRC">CRC (colones)</option>
                    <option value="USD">USD (dólares)</option>
                    <option value="EUR">EUR (euros)</option>
                  </select>
                </label>
                <div className="form-actions">
                  <button type="submit" className="btn btn-primary" disabled={creandoEmp}>
                    {creandoEmp ? 'Creando…' : 'Crear empresa'}
                  </button>
                </div>
              </form>
            )}

            <table className="table">
              <thead>
                <tr>
                  <th>Cédula</th>
                  <th>Nombre</th>
                  <th>Tipo</th>
                  <th>Total facturas</th>
                  <th>Facturas mes</th>
                  <th>Total CRC mes</th>
                </tr>
              </thead>
              <tbody>
                {empresas.map((e) => (
                  <tr key={e.id}>
                    <td className="mono">{e.id}</td>
                    <td>{e.nombre}</td>
                    <td>{e.tipo_cedula}</td>
                    <td className="num">{e.total_facturas}</td>
                    <td className="num">{e.facturas_mes}</td>
                    <td className="num">{moneda(e.total_crc_mes, 'CRC')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
