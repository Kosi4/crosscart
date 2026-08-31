window.Crosscart = window.Crosscart || {};

(function () {
  function attachDragAndDrop(container, items, onReorder) {
    let dragIndex = null;

    container.querySelectorAll('.crosscart-item').forEach((el) => {
      el.addEventListener('dragstart', () => {
        dragIndex = Number(el.dataset.index);
        el.classList.add('crosscart-dragging');
      });

      el.addEventListener('dragend', () => {
        el.classList.remove('crosscart-dragging');
      });

      el.addEventListener('dragover', (e) => {
        e.preventDefault();
      });

      el.addEventListener('drop', (e) => {
        e.preventDefault();
        const dropIndex = Number(el.dataset.index);
        if (dragIndex === null || dragIndex === dropIndex) return;
        const reordered = [...items];
        const [moved] = reordered.splice(dragIndex, 1);
        reordered.splice(dropIndex, 0, moved);
        onReorder(reordered);
      });
    });
  }

  window.Crosscart.dnd = { attachDragAndDrop };
})();
