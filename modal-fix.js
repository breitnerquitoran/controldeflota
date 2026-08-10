// Script para arreglar el modal de selección de daños

// Función para manejar la selección de opciones de daño
function toggleDamageOption(optionElement) {
    console.log('toggleDamageOption llamada', optionElement);
    
    const checkbox = optionElement.querySelector('input[type="checkbox"]');
    console.log('Checkbox encontrado:', checkbox);
    
    if (!checkbox) {
        console.error('No se encontró el checkbox');
        return;
    }
    
    const isCurrentlySelected = optionElement.classList.contains('selected');
    console.log('Estado actual seleccionado:', isCurrentlySelected);

    if (isCurrentlySelected) {
        // Deseleccionar
        optionElement.classList.remove('selected');
        checkbox.checked = false;
        console.log('Deseleccionado:', checkbox.value);
    } else {
        // Seleccionar
        optionElement.classList.add('selected');
        checkbox.checked = true;
        console.log('Seleccionado:', checkbox.value);
    }

    // Agregar efecto visual de feedback
    optionElement.style.transform = 'scale(0.95)';
    setTimeout(() => {
        optionElement.style.transform = '';
    }, 150);
    
    // Verificar el estado después del cambio
    const allChecked = document.querySelectorAll('input[name="condition"]:checked');
    console.log('Total checkboxes marcados después del cambio:', allChecked.length);
    allChecked.forEach(cb => console.log('Checkbox marcado:', cb.value));
}

// Función para enviar la selección del modal
function submitSelection() {
    console.log('submitSelection llamada');
    
    // Obtener el título del modal (pieza)
    const piece = document.getElementById('modal-title').textContent;
    console.log('Pieza:', piece);

    // Obtener los valores seleccionados de los checkboxes
    const checkedConditions = Array.from(
        document.querySelectorAll('input[name="condition"]:checked')
    ).map(checkbox => checkbox.value);
    console.log('Condiciones seleccionadas:', checkedConditions);

    // Combinar los valores de los checkboxes en un string
    const conditionText = checkedConditions.join(', ') || 'Sin estado';
    console.log('Texto de condición:', conditionText);

    // Obtener las observaciones del textarea
    const observations = document.querySelector('.observations')?.value || 'Sin observaciones';
    console.log('Observaciones:', observations);

    // Verificar si ya existe una entrada para esta pieza
    const table = $('#inspection-table').DataTable();
    const existingRowIndex = table.rows().indexes().filter(function (index) {
        return table.row(index).data()[0] === piece;
    });

    if (existingRowIndex.length > 0) {
        // Actualizar la fila existente
        console.log('Actualizando fila existente');
        const rowIndex = existingRowIndex[0];
        table.row(rowIndex).data([
            piece,
            conditionText,
            observations,
            currentPhotoData || table.row(rowIndex).data()[3], // Mantener foto existente si no hay nueva
            currentPhotoData || table.row(rowIndex).data()[4]
        ]).draw(false);
    } else {
        // Agregar una nueva fila al DataTable
        console.log('Agregando nueva fila');
        table.row.add([
            piece,                       // Columna de Pieza
            conditionText,               // Columna de Estado
            observations,                // Columna de Observaciones
            currentPhotoData || '',      // Columna de Foto (URL de datos de la imagen o cadena vacía)
            currentPhotoData || ''       // Columna oculta con datos de foto
        ]).draw(false);
    }

    // Aplicar color al SVG si hay condiciones seleccionadas
    if (checkedConditions.length > 0) {
        console.log('Aplicando colores al SVG');
        applyDamageColor(piece, checkedConditions);
    } else {
        console.log('Restaurando color original');
        restorePieceColor(piece);
    }

    // Mostrar un mensaje de éxito y cerrar el modal
    Swal.fire({
        icon: 'success',
        title: '¡Guardado!',
        text: 'Selección guardada correctamente',
        timer: 1500,
        showConfirmButton: false,
        toast: true,
        position: 'top-end'
    });
    closeModal();

    // Limpiar el formulario para la próxima selección
    resetModalForm();
}

// Función para resetear el formulario del modal
function resetModalForm() {
    console.log('Reseteando formulario del modal');
    
    const conditionForm = document.getElementById('condition-form');
    if (conditionForm) {
        conditionForm.reset();
    }
    
    // Remover clases de selección visual
    const damageOptions = document.querySelectorAll('.damage-option');
    damageOptions.forEach(option => {
        option.classList.remove('selected');
    });
    
    // Limpiar foto
    if (typeof currentPhotoData !== 'undefined') {
        currentPhotoData = null;
    }
    const photoPreview = document.getElementById('photo-preview');
    if (photoPreview) {
        photoPreview.style.display = 'none';
        photoPreview.src = '';
    }
    
    // Resetear video de cámara si existe
    const videoElement = document.getElementById('camera-stream');
    if (videoElement) {
        videoElement.style.display = 'none';
    }
}

console.log('Modal fix script cargado');