const { app, Menu } = require( 'electron' )
const fs = require( 'fs' )

/* Fix: content can't render on a virtual machine */
app.disableHardwareAcceleration()

/* Set the cache path */
const USER_CACHE_PATH = `${ require( './variables' ).CACHE_PATH }\\${ process.env.USERNAME }`
app.setPath( 'userData', USER_CACHE_PATH )

let bl = null

exports.getBlInstance = () => {
    return bl
}

process.on( 'uncaughtException', onError )

const gotTheLock = app.requestSingleInstanceLock()

if ( !gotTheLock ) {
    app.quit()
} else {
    app.on( 'second-instance', ( event, commandLine, workingDirectory ) => {
        // Someone tried to run a second instance, we should focus our window.
        try {
            let mainWindow = bl.get( 'MainWindowStartLogic' ).getMainWindow()
            if ( mainWindow ) {
                if ( mainWindow.isMinimized() ) { // was minimized with .minimize()
                    bl.get( 'CommonLogic' ).traceInfo( 'Second instance of app restore minimized main window' )
                    mainWindow.restore()
                    bl.get( 'StatisticsLogic' ).sendStatistics( { key: 'main_window_opened_from_minimized_state', action: 'NavigationEvent' } )
                } else if ( !mainWindow.isVisible() ) { // was hidden with .hide()
                    bl.get( 'CommonLogic' ).traceInfo( 'Second instance of app show main window' )
                    mainWindow.show()
                    bl.get( 'StatisticsLogic' ).sendStatistics( { key: 'main_window_focused', action: 'NavigationEvent' } )
                }
                bl.get( 'CommonLogic' ).traceInfo( 'Second instance of app focus main window' )
                mainWindow.focus()
            } else {
                if ( commandLine && commandLine.includes( '--minimized-in-tray' ) ) {
                    bl.get( 'CommonLogic' ).traceInfo( '--minimized-in-tray passed in second instance of app' )
                } else {
                    bl.get( 'CommonLogic' ).traceInfo( '--minimized-in-tray is not passed in second instance of app' )
                    bl.get( 'CommonLogic' ).traceInfo( 'Second instance of app create and show main window' )
                    bl.get( 'MainWindowStartLogic' ).createAndShowMainWindow()
                    bl.get( 'StatisticsLogic' ).sendStatistics( { key: 'main_window_was_opened_by_shortcut', action: 'NavigationEvent' } )
                }
            }
        } catch ( error ) {
            // Судя по всему кто-то 1000 раз в милисекунду жмет на ярлык
            // и новые инстансы app создаются раньше, чем был сконструирован bl,
            // который должен создаться в момент готовности первого app ( сбытие 'ready' ), но не успевает
        }
    } )

    app.on( 'ready', () => {
        let isSpectronEnabled = false
        let isDebug = false

        try {
            bl = constructBl()

            // Ручка для Spectron
            // В нем мы дожидаемся, пока будет загружено окно (waitUntilWindowLoaded), только потом зовем этот метод,
            // поэтому к тому моменту bl уже точно будет сконструирован, ибо окно создается именно bl-ем
            isSpectronEnabled =  bl.get( 'PropertiesLogic' ).isSpectronEnabled()

            if ( isSpectronEnabled ) {
                app.execute = ( LogicName, methodName, args = [] ) => {
                    return bl.execute( LogicName, methodName, args )
                }
            }
        } catch ( error ) {
            onError( error )
            return
        }

        if ( process.argv && process.argv.includes( '--minimized-in-tray' ) ) {
            bl.get( 'CommonLogic' ).traceInfo( 'Main.js: --minimized-in-tray passed, do not create window' )
        } else {
            bl.get( 'MainWindowStartLogic' ).createAndShowMainWindow()
            bl.get( 'CommonLogic' ).traceInfo( 'Main.js: --minimized-in-tray is not passed, create window' )
            bl.get( 'StatisticsLogic' ).sendStatistics( { key: 'main_window_was_opened', action: 'NavigationEvent' } )
        }

        if ( !Menu.getApplicationMenu() ) {
            // For devtools shortcut can work (ctrl+shift+i)
            isDebug = bl.get( 'PropertiesLogic' ).isDebug()

            const template = [
                {
                    label: 'View',
                    submenu: [
                        {
                            role: isDebug || isSpectronEnabled ? 'toggledevtools' : ''
                        }
                    ]
                } ]

            const menu = Menu.buildFromTemplate( template )
            Menu.setApplicationMenu( menu )
        }

    } )
}

function constructBl() {
    const { BL } = require( './bl.js' )

    process.blockDumpWriterOnExit = () => { // FIXME костыль, чтобы отключить запись дампа electron на выгрузке BUG 3834422
        bl.get( 'CommonLogic' ).traceInfo( 'process.blockDumpWriterOnExit was called' )
        process.isDumpWriterBlocked = true
    }
    // ремоутно нельзя получить process.pid, поэтому передаем объект process явно из main-файла в конструктор BL
    return new BL( require( 'electron' ), require( '../../kasapi.js' ), { fs: require( 'fs' ) }, process )
}

function createErrorLog( errorMessage ) {
    let date = new Date(),
        day = date.getDate(),
        month = date.getMonth() + 1,
        year = date.getFullYear(),
        hours = date.getHours(),
        minutes = date.getMinutes(),
        milliseconds = date.getMilliseconds()

    month < 10 ? month = `0${ month }` : month
    day < 10 ? day = `0${ day }` : day
    hours < 10 ? hours = `0${ hours }` : hours
    minutes < 10 ? minutes = `0${ minutes }` : minutes

    fs.writeFileSync( `${ require( './variables' ).LOGS_PATH }\\JS_LOG_${ day }.${ month }.${ year }_${ hours }.${ minutes }.${ milliseconds }_${ process.pid }.log`, errorMessage )
}

function onError( error ) {
    try {
        if ( error.stack ) {
            createErrorLog( error.stack )
        } else {
            createErrorLog( error )
        }
    } catch( err ) {
        console.log( 'Cannot create error log' )
    }
    try {
        if( !process.isDumpWriterBlocked ) { // FIXME костыль, чтобы отключить запись дампа electron на выгрузке BUG 3834422
            bl.get( 'CommonLogic' ).createDump( error.stack ? error.stack : error )
        }
    } catch( err ) {
        console.log( 'Cannot get bl instance' )
    }
}

// Utils ----------------

function showMessage( message ) {
    const dialog = require( 'electron' ).dialog

    if ( typeof message === 'object' ) {
        for ( let key in message ) {
            dialog.showErrorBox( `Object passed to showMessage. Key: ${ key }`, message[ key ].toString() )
        }
    } else if ( typeof message !== 'string' ) {
        dialog.showErrorBox( 'Info', message.toString() )
    } else {
        dialog.showErrorBox( 'Info', message )
    }
}
