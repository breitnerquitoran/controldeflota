/**
 * Control de acceso del lado del navegador.
 *
 * Se carga en el <head> de todas las páginas, antes que cualquier otro script:
 *   - si no hay sesión, manda al login;
 *   - si el rol no alcanza para la página, avisa y devuelve al inicio;
 *   - firma automáticamente las llamadas a /api/ con el token de la sesión;
 *   - arma el menú del usuario (cambiar clave / salir) y esconde las opciones
 *     que su rol no puede abrir.
 *
 * El filtro de verdad está en el servidor (server.js): esto solo evita que a
 * nadie le aparezcan pantallas que no le tocan.
 */
(function () {
    'use strict';

    var CLAVE_SESION = 'flotaSesion';
    var PAGINA_LOGIN = 'login.html';

    // Qué rol puede abrir cada pantalla. El administrador ve todo.
    var PAGINAS = {
        'index.html': ['usuario', 'admin'],
        'inspection.html': ['usuario', 'admin'],
        'historico.html': ['usuario', 'admin'],
        'odometros.html': ['maestranza', 'admin'],
        'maestranza.html': ['maestranza', 'admin'],
        'admin.html': ['admin'],
        'usuarios.html': ['admin']
    };

    // A dónde llega cada rol al entrar o al pedir una pantalla que no le toca
    var PAGINA_INICIAL = {
        admin: 'admin.html',
        maestranza: 'maestranza.html',
        usuario: 'index.html'
    };

    var ETIQUETA_ROL = {
        admin: 'Administración',
        maestranza: 'Maestranza',
        usuario: 'Usuario'
    };

    function paginaActual() {
        var archivo = (window.location.pathname.split('/').pop() || '').toLowerCase();
        return archivo || 'index.html';
    }

    // ============================================================
    // Sesión guardada en el navegador
    // ============================================================

    function leerSesion() {
        try {
            return JSON.parse(localStorage.getItem(CLAVE_SESION) || 'null');
        } catch (e) {
            return null;
        }
    }

    function guardarSesion(sesion) {
        localStorage.setItem(CLAVE_SESION, JSON.stringify(sesion));
    }

    function cerrarSesion(destino) {
        localStorage.removeItem(CLAVE_SESION);
        window.location.replace(destino || PAGINA_LOGIN);
    }

    var sesion = leerSesion();
    var esPaginaPublica = window.AUTH_PAGINA_PUBLICA === true;

    // ============================================================
    // Llamadas a la API firmadas con el token
    // ============================================================

    function esLlamadaApi(recurso) {
        var url = typeof recurso === 'string' ? recurso : (recurso && recurso.url) || '';
        return url.indexOf('/api/') === 0 || url.indexOf('api/') === 0;
    }

    var fetchOriginal = window.fetch ? window.fetch.bind(window) : null;

    if (fetchOriginal) {
        window.fetch = function (recurso, opciones) {
            var config = opciones || {};

            if (esLlamadaApi(recurso) && sesion && sesion.token) {
                var cabeceras = new Headers(config.headers || (typeof recurso === 'object' ? recurso.headers : null) || {});
                cabeceras.set('Authorization', 'Bearer ' + sesion.token);
                config = Object.assign({}, config, { headers: cabeceras });
            }

            return fetchOriginal(recurso, config).then(function (respuesta) {
                // La sesión caducó o la cerraron desde administración
                if (respuesta.status === 401 && esLlamadaApi(recurso) && !esPaginaPublica) {
                    cerrarSesion(PAGINA_LOGIN + '?expirada=1');
                }
                return respuesta;
            });
        };
    }

    // Las tablas y utilidades que usan jQuery pasan por su propio canal
    document.addEventListener('DOMContentLoaded', function () {
        if (window.jQuery && sesion && sesion.token) {
            window.jQuery.ajaxSetup({
                beforeSend: function (peticion, opciones) {
                    if (esLlamadaApi(opciones.url || '')) {
                        peticion.setRequestHeader('Authorization', 'Bearer ' + sesion.token);
                    }
                }
            });
        }
    });

    // ============================================================
    // Guardia de la página
    // ============================================================

    if (!esPaginaPublica) {
        if (!sesion || !sesion.token || !sesion.usuario) {
            cerrarSesion();
            return;
        }

        var permitidos = PAGINAS[paginaActual()] || ['usuario', 'admin'];

        if (permitidos.indexOf(sesion.usuario.rol) === -1) {
            window.location.replace(PAGINA_INICIAL[sesion.usuario.rol] || 'index.html');
            return;
        }

        // Marca el rol en el documento antes de pintar nada: los controles con
        // data-solo-admin desaparecen sin parpadeo para todo el que no sea
        // administrador. Así maestranza no ve costos ni presupuestos, igual que
        // el rol 'usuario' no ve las acciones de edición del histórico.
        document.documentElement.classList.add('auth-rol-' + sesion.usuario.rol);

        var reglaRol = document.createElement('style');
        reglaRol.textContent = 'html:not(.auth-rol-admin) [data-solo-admin]{display:none !important}';
        document.head.appendChild(reglaRol);
    }

    // ============================================================
    // Menú del usuario y opciones visibles según el rol
    // ============================================================

    function estilos() {
        if (document.getElementById('auth-estilos')) return;

        var hoja = document.createElement('style');
        hoja.id = 'auth-estilos';
        hoja.textContent = [
            '.auth-menu{position:relative}',
            '.auth-menu>button{display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.12);color:#fff;border:0;border-radius:999px;padding:6px 14px;font-size:.9rem;cursor:pointer}',
            '.auth-menu>button:hover{background:rgba(255,255,255,.22)}',
            '.auth-menu .auth-rol{font-size:.72rem;opacity:.8}',
            '.auth-panel{display:none;position:absolute;right:0;top:calc(100% + 8px);min-width:210px;background:#fff;border-radius:12px;box-shadow:0 12px 30px rgba(0,0,0,.2);overflow:hidden;z-index:1080}',
            '.auth-panel.abierto{display:block}',
            '.auth-panel button{display:flex;align-items:center;gap:10px;width:100%;background:none;border:0;padding:11px 16px;text-align:left;font-size:.9rem;color:#2c3e50;cursor:pointer}',
            '.auth-panel button:hover{background:#f1f5f9}',
            '.auth-panel button.auth-salir{color:#c0392b;border-top:1px solid #eceff1}',
            '.auth-fondo{display:none;position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:1090;align-items:center;justify-content:center;padding:16px}',
            '.auth-fondo.abierto{display:flex}',
            '.auth-dialogo{background:#fff;border-radius:16px;padding:26px;width:100%;max-width:420px;box-shadow:0 20px 50px rgba(0,0,0,.3)}',
            '.auth-dialogo h3{margin:0 0 6px;font-size:1.25rem;color:#2c3e50}',
            '.auth-dialogo p{margin:0 0 18px;font-size:.88rem;color:#7f8c8d}',
            '.auth-dialogo label{display:block;font-size:.82rem;font-weight:600;color:#34495e;margin-bottom:6px}',
            '.auth-dialogo input{width:100%;padding:11px 14px;border:2px solid #e3e8ee;border-radius:10px;margin-bottom:14px;font-size:.95rem}',
            '.auth-dialogo input:focus{outline:none;border-color:#0097c6}',
            '.auth-acciones{display:flex;gap:10px;justify-content:flex-end;margin-top:6px}',
            '.auth-acciones button{border:0;border-radius:10px;padding:10px 18px;font-size:.9rem;font-weight:600;cursor:pointer}',
            '.auth-acciones .auth-cancelar{background:#eceff1;color:#546e7a}',
            '.auth-acciones .auth-aceptar{background:#0097c6;color:#fff}',
            '.auth-aviso{font-size:.85rem;margin-bottom:12px;display:none}',
            '.auth-aviso.error{display:block;color:#c0392b}',
            '.auth-aviso.ok{display:block;color:#1e8449}'
        ].join('');

        document.head.appendChild(hoja);
    }

    function pintarMenu() {
        var barra = document.querySelector('.navbar-nav');
        if (!barra || !sesion) return;

        var rol = sesion.usuario.rol;

        // Esconde las pantallas que este rol no puede abrir
        barra.querySelectorAll('a.nav-link[href]').forEach(function (enlace) {
            var destino = (enlace.getAttribute('href') || '').split('/').pop().toLowerCase();
            var permitidos = PAGINAS[destino];

            if (permitidos && permitidos.indexOf(rol) === -1) {
                var item = enlace.closest('li') || enlace;
                item.style.display = 'none';
            }
        });

        // El logotipo y el enlace de volver apuntan al inicio en las siete
        // páginas. Para quien no puede abrir esa pantalla serían un rebote al
        // login, así que se redirigen a la portada de su rol desde aquí y no
        // duplicando el arreglo en cada HTML.
        var inicio = PAGINA_INICIAL[rol] || 'index.html';

        document.querySelectorAll('.navbar-brand[href], .back-link[href]').forEach(function (enlace) {
            var destino = (enlace.getAttribute('href') || '').split('/').pop().toLowerCase();
            var permitidos = PAGINAS[destino];

            if (permitidos && permitidos.indexOf(rol) === -1) {
                enlace.setAttribute('href', inicio);
            }
        });

        // Los administradores además llegan a la gestión de usuarios
        if (rol === 'admin' && !barra.querySelector('a[href="usuarios.html"]')) {
            var item = document.createElement('li');
            item.className = 'nav-item';
            item.innerHTML = '<a class="nav-link" href="usuarios.html"><i class="fas fa-users"></i> Usuarios</a>';

            if (paginaActual() === 'usuarios.html') {
                item.querySelector('a').classList.add('active');
            }

            barra.appendChild(item);
        }

        if (barra.querySelector('.auth-menu')) return;

        var menu = document.createElement('li');
        menu.className = 'nav-item auth-menu d-flex align-items-center ms-lg-3 my-2 my-lg-0';
        menu.innerHTML =
            '<button type="button" id="auth-boton">' +
                '<i class="fas fa-user-circle"></i>' +
                '<span>' + textoPlano(sesion.usuario.nombre || sesion.usuario.usuario) + '</span>' +
                '<span class="auth-rol">(' + (ETIQUETA_ROL[rol] || rol) + ')</span>' +
                '<i class="fas fa-chevron-down" style="font-size:.7rem"></i>' +
            '</button>' +
            '<div class="auth-panel" id="auth-panel">' +
                '<button type="button" id="auth-cambiar"><i class="fas fa-key"></i> Cambiar mi clave</button>' +
                '<button type="button" class="auth-salir" id="auth-salir"><i class="fas fa-right-from-bracket"></i> Cerrar sesión</button>' +
            '</div>';

        barra.appendChild(menu);

        var panel = menu.querySelector('#auth-panel');

        menu.querySelector('#auth-boton').addEventListener('click', function (evento) {
            evento.stopPropagation();
            panel.classList.toggle('abierto');
        });

        document.addEventListener('click', function () {
            panel.classList.remove('abierto');
        });

        menu.querySelector('#auth-cambiar').addEventListener('click', function () {
            panel.classList.remove('abierto');
            abrirCambioDeClave(false);
        });

        menu.querySelector('#auth-salir').addEventListener('click', function () {
            cerrarSesion();
        });
    }

    function textoPlano(valor) {
        var caja = document.createElement('span');
        caja.textContent = valor == null ? '' : valor;
        return caja.innerHTML;
    }

    // ============================================================
    // Cambio de clave (voluntario u obligatorio en el primer ingreso)
    // ============================================================

    function abrirCambioDeClave(obligatorio) {
        estilos();

        var fondo = document.getElementById('auth-cambio-clave');

        if (!fondo) {
            fondo = document.createElement('div');
            fondo.id = 'auth-cambio-clave';
            fondo.className = 'auth-fondo';
            fondo.innerHTML =
                '<div class="auth-dialogo">' +
                    '<h3>Cambiar mi clave</h3>' +
                    '<p id="auth-cambio-texto">Elige una clave nueva de al menos 6 caracteres.</p>' +
                    '<div class="auth-aviso" id="auth-cambio-aviso"></div>' +
                    '<label for="auth-clave-actual">Clave actual</label>' +
                    '<input type="password" id="auth-clave-actual" autocomplete="current-password">' +
                    '<label for="auth-clave-nueva">Clave nueva</label>' +
                    '<input type="password" id="auth-clave-nueva" autocomplete="new-password">' +
                    '<label for="auth-clave-repetida">Repite la clave nueva</label>' +
                    '<input type="password" id="auth-clave-repetida" autocomplete="new-password">' +
                    '<div class="auth-acciones">' +
                        '<button type="button" class="auth-cancelar" id="auth-cambio-cancelar">Cancelar</button>' +
                        '<button type="button" class="auth-aceptar" id="auth-cambio-guardar">Guardar</button>' +
                    '</div>' +
                '</div>';

            document.body.appendChild(fondo);

            fondo.querySelector('#auth-cambio-cancelar').addEventListener('click', function () {
                fondo.classList.remove('abierto');
            });

            fondo.querySelector('#auth-cambio-guardar').addEventListener('click', guardarClaveNueva);
        }

        fondo.querySelector('#auth-cambio-texto').textContent = obligatorio
            ? 'Es tu primer ingreso con esta clave: cámbiala para continuar.'
            : 'Elige una clave nueva de al menos 6 caracteres.';

        fondo.querySelector('#auth-cambio-cancelar').style.display = obligatorio ? 'none' : '';
        fondo.dataset.obligatorio = obligatorio ? '1' : '';
        fondo.querySelector('#auth-cambio-aviso').className = 'auth-aviso';
        ['auth-clave-actual', 'auth-clave-nueva', 'auth-clave-repetida'].forEach(function (id) {
            fondo.querySelector('#' + id).value = '';
        });

        fondo.classList.add('abierto');
        fondo.querySelector('#auth-clave-actual').focus();
    }

    function guardarClaveNueva() {
        var fondo = document.getElementById('auth-cambio-clave');
        var aviso = fondo.querySelector('#auth-cambio-aviso');
        var actual = fondo.querySelector('#auth-clave-actual').value;
        var nueva = fondo.querySelector('#auth-clave-nueva').value;
        var repetida = fondo.querySelector('#auth-clave-repetida').value;

        function fallo(mensaje) {
            aviso.className = 'auth-aviso error';
            aviso.textContent = mensaje;
        }

        if (nueva.length < 6) return fallo('La clave nueva debe tener al menos 6 caracteres');
        if (nueva !== repetida) return fallo('Las dos claves nuevas no coinciden');

        var boton = fondo.querySelector('#auth-cambio-guardar');
        boton.disabled = true;

        fetch('/api/auth/cambiar-clave', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clave_actual: actual, clave_nueva: nueva })
        })
            .then(function (respuesta) {
                return respuesta.json().then(function (cuerpo) {
                    if (!respuesta.ok) throw new Error(cuerpo.error || 'No se pudo cambiar la clave');
                    return cuerpo;
                });
            })
            .then(function () {
                aviso.className = 'auth-aviso ok';
                aviso.textContent = 'Clave actualizada';

                if (sesion) {
                    sesion.usuario.debe_cambiar_clave = false;
                    guardarSesion(sesion);
                }

                setTimeout(function () { fondo.classList.remove('abierto'); }, 900);
            })
            .catch(function (error) {
                fallo(error.message);
            })
            .finally(function () {
                boton.disabled = false;
            });
    }

    // ============================================================
    // Arranque
    // ============================================================

    if (!esPaginaPublica) {
        document.addEventListener('DOMContentLoaded', function () {
            estilos();
            pintarMenu();

            // Revalida contra el servidor: el rol pudo cambiar o la cuenta pudo
            // desactivarse desde que se guardó la sesión en este navegador.
            fetch('/api/auth/me')
                .then(function (respuesta) {
                    if (!respuesta.ok) throw new Error('sesión no válida');
                    return respuesta.json();
                })
                .then(function (usuario) {
                    var cambioDeRol = usuario.rol !== sesion.usuario.rol;

                    sesion.usuario = usuario;
                    guardarSesion(sesion);

                    if (cambioDeRol) {
                        window.location.reload();
                        return;
                    }

                    if (usuario.debe_cambiar_clave) {
                        abrirCambioDeClave(true);
                    }
                })
                .catch(function () {
                    // El 401 ya lo maneja el envoltorio de fetch; el resto son
                    // cortes de red y no deberían echar a nadie de la pantalla.
                });
        });
    }

    // API pública para el login y para las pantallas que la necesiten
    window.Auth = {
        sesion: function () { return leerSesion(); },
        usuario: function () { var s = leerSesion(); return s && s.usuario; },
        rol: function () { var s = leerSesion(); return s && s.usuario && s.usuario.rol; },
        esAdmin: function () { var s = leerSesion(); return !!s && s.usuario.rol === 'admin'; },
        esMaestranza: function () { var s = leerSesion(); return !!s && s.usuario.rol === 'maestranza'; },
        // Pantalla de entrada de cada rol: el login la usa para no rebotar
        paginaInicial: function (rol) {
            var s = leerSesion();
            return PAGINA_INICIAL[rol || (s && s.usuario && s.usuario.rol)] || 'index.html';
        },
        guardar: guardarSesion,
        salir: cerrarSesion,
        cambiarClave: function () { abrirCambioDeClave(false); }
    };
})();
