import { debounce, cloneNodeWithEvents } from './index';

//Global Variables
let dragElement;
const DEFAULT_OPTIONS = {
  sortable: false,
  acceptFrom: '',
  placeholderClass: '',
  copy: true,
  addOnDrop: true,
};
export class Draggable {
  dragContainer: HTMLElement;
  options;
  childElements = [];
  acceptFrom = [];
  placeholder: HTMLElement;
  nextSibling: HTMLElement;
  previousContainer;
  cancelDebouncedDrag;

  debouncedSetElement = debounce(
    (childElements, draggingElement, y) => {
      if (this.cancelDebouncedDrag) {
        return;
      }

      const afterElement = this.getDragAfterElement(childElements, y);

      let newElement;
      // dragging inside the same container, so no need to add placeholder
      if (
        draggingElement.parentElement.id === this.dragContainer.id ||
        !this.options.copy
      ) {
        newElement = draggingElement;
      } else {
        this.placeholder ||= this.createPlaceholder(draggingElement);
        newElement = this.placeholder;
      }
      this.addElement(newElement, afterElement);
    },
    this,
    5
  );

  constructor(container, options) {
    this.dragContainer = container;
    this.options = Object.assign({}, DEFAULT_OPTIONS, options);
    this.childElements = Array.from(this.dragContainer.children);
    this.acceptFrom = this.options.acceptFrom
      ? this.options.acceptFrom.split(',')
      : [];
    this.options.sortable && this.acceptFrom.push(this.dragContainer.id);
    this.addListeners();
  }

  private onDragStart = (e) => {
    dragElement = e.target;
    this.cancelDebouncedDrag = false;

    // Set dragElementId for Firefox
    e.dataTransfer.setData('text/plain', dragElement.id);

    // Set all items inside the drag container except the current element
    const draggingElementIndex = this.childElements.indexOf(dragElement);
    this.nextSibling = this.childElements[draggingElementIndex + 1];
    this.childElements.splice(draggingElementIndex, 1);
  };

  private onDragEnter = (e) => {
    if (!dragElement) {
      return;
    }
    const sortContainer = e
      .composedPath()
      .find((el) => el.id === this.dragContainer.id);
    if (sortContainer && sortContainer !== this.previousContainer) {
      // the drag element have entered or re-entered current drag container
      this.cancelDebouncedDrag = false;
    }
    this.previousContainer = sortContainer;
  };

  private onDragLeave = (e) => {
    if (!dragElement) {
      return;
    }
    const outTarget = e.fromElement || e.relatedTarget;
    if (!e.currentTarget.contains(outTarget)) {
      // Check whether the outTarget's host (in case of shadow dom) exists in currentTarget
      const parentHost = this.getMatchingHost(
        outTarget,
        this.dragContainer.children[0].tagName
      );
      if (!e.currentTarget.contains(parentHost)) {
        // the drag element have left the current container(this.host)
        this.previousContainer = undefined;
        this.cancelDebouncedDrag = true;

        if (dragElement.parentElement.id !== this.dragContainer.id) {
          // dragElement from another container
          this.removePlaceholder();
        } else {
          // Sort within the same container
          this.addElement(dragElement, this.nextSibling);
        }
      }
    }
  };

  private onDragOver = (e) => {
    e.preventDefault();
    if (!dragElement) {
      return;
    }
    const sortContainerId = dragElement.parentElement.id;
    if (this.acceptFrom.includes(sortContainerId)) {
      this.debouncedSetElement(this.childElements, dragElement, e.clientY);
    }
  };

  // Both dragend and drop need to used as the drop will be fired only on the container on which the drag is dropped
  // and no on the container where drag is originated.
  private onDragEnd = (e) => {
    this.resetData(e);
  };

  private onDrop = (e) => {
    if (!dragElement) {
      return;
    }
    const sortContainerId = dragElement.parentElement.id;
    if (!this.acceptFrom.includes(sortContainerId)) {
      return;
    }
    const newElement = this.placeholder || dragElement;
    const droppedIndex = [...this.dragContainer.children].indexOf(newElement);
    if (this.placeholder) {
      if (this.options.addOnDrop) {
        const clone = cloneNodeWithEvents(dragElement, true, true);
        this.placeholder.replaceWith(clone);
      } else {
        this.removePlaceholder();
      }
    }
    this.dragContainer.dispatchEvent(
      new CustomEvent('fwDropBase', {
        cancelable: true,
        bubbles: false,
        detail: {
          droppedElement: dragElement,
          droppedIndex,
          dragFromId: sortContainerId,
          dropToId: this.dragContainer.id,
        },
      })
    );
    this.resetData(e);
  };

  addListeners() {
    this.dragContainer.addEventListener('dragstart', (e) =>
      this.onDragStart(e)
    );
    this.dragContainer.addEventListener('dragend', (e) => this.onDragEnd(e));
    this.dragContainer.addEventListener('dragenter', (e) =>
      this.onDragEnter(e)
    );
    this.dragContainer.addEventListener('dragleave', (e) =>
      this.onDragLeave(e)
    );
    this.dragContainer.addEventListener('dragover', (e) => this.onDragOver(e));
    this.dragContainer.addEventListener('drop', (e) => this.onDrop(e));
  }

  removeListeners() {
    this.dragContainer.removeEventListener('dragstart', (e) =>
      this.onDragStart(e)
    );
    this.dragContainer.removeEventListener('dragend', (e) => this.onDragEnd(e));
    this.dragContainer.removeEventListener('dragenter', (e) =>
      this.onDragEnter(e)
    );
    this.dragContainer.removeEventListener('dragleave', (e) =>
      this.onDragLeave(e)
    );
    this.dragContainer.removeEventListener('dragover', (e) =>
      this.onDragOver(e)
    );
    this.dragContainer.removeEventListener('drop', (e) => this.onDrop(e));
  }

  getDragAfterElement(elements, y) {
    return elements.reduce(
      (closest, child) => {
        const box = child.getBoundingClientRect();
        // Subtracting mouse y position with the middle of the element
        // to check whether the dragging element is above an element
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
          return { offset: offset, element: child };
        } else {
          return closest;
        }
      },
      { offset: Number.NEGATIVE_INFINITY }
    ).element;
  }

  createPlaceholder(sourceElement) {
    const placeholderClass = this.options.placeholderClass;
    const containerTag = this.dragContainer.tagName;
    let placeholder;
    if (['UL', 'OL'].includes(containerTag)) {
      placeholder = document.createElement('li');
    } else if (['TABLE', 'TBODY'].includes(containerTag)) {
      placeholder = document.createElement('tr');
      // set colspan to always all rows, otherwise the item can only be dropped in first column
      placeholder.innerHTML = '<td colspan="100"></td>';
    } else {
      placeholder = document.createElement('div');
    }
    // set style for the placeholder
    if (typeof placeholderClass === 'string' && placeholderClass) {
      placeholder.classList.add(...placeholderClass.split(' '));
    } else {
      placeholder.style.height = this.getElementHeight(sourceElement) + 'px';
      placeholder.style.width = this.getElementWidth(sourceElement) + 'px';
    }

    return placeholder;
  }

  removePlaceholder(element?) {
    const removeElement = element || this.placeholder;
    this.dragContainer.contains(removeElement) &&
      this.dragContainer.removeChild(removeElement);
  }

  addElement(newElement, nextElement) {
    if (nextElement) {
      this.canInsertBefore(nextElement) &&
        this.dragContainer.insertBefore(newElement, nextElement);
      return;
    }
    this.canAppendTo(this.dragContainer) &&
      this.dragContainer.appendChild(newElement);
  }

  canInsertBefore(element) {
    return element && element.pinned !== 'top';
  }

  canAppendTo(container) {
    return container.lastElementChild.pinned !== 'bottom';
  }

  getHost(element) {
    return element.getRootNode().host;
  }

  getMatchingHost(element, tagName) {
    let matchingElement = element;
    while (matchingElement) {
      matchingElement = this.getHost(matchingElement);
      if (matchingElement && matchingElement.tagName === tagName) {
        return matchingElement;
      }
    }
    return undefined;
  }

  resetData(e) {
    e.dataTransfer.clearData();
    this.childElements = Array.from(this.dragContainer.children);
    this.previousContainer = undefined;
    dragElement = undefined;
    this.placeholder = undefined;
    this.cancelDebouncedDrag = true;
  }

  getElementHeight(element) {
    if (!(element instanceof HTMLElement)) {
      throw new Error('You must provide a valid dom element');
    }
    // get calculated style of element
    const style = window.getComputedStyle(element);
    // get only height if element has box-sizing: border-box specified
    if (style.getPropertyValue('box-sizing') === 'border-box') {
      return parseInt(style.getPropertyValue('height'), 10);
    }
    // pick applicable properties, convert to int and reduce by adding
    return ['height', 'padding-top', 'padding-bottom']
      .map(function (key) {
        const int = parseInt(style.getPropertyValue(key), 10);
        return isNaN(int) ? 0 : int;
      })
      .reduce(function (sum, value) {
        return sum + value;
      });
  }

  getElementWidth(element) {
    if (!(element instanceof HTMLElement)) {
      throw new Error('You must provide a valid dom element');
    }
    // get calculated style of element
    const style = window.getComputedStyle(element);
    // pick applicable properties, convert to int and reduce by adding
    return ['width', 'padding-left', 'padding-right']
      .map(function (key) {
        const int = parseInt(style.getPropertyValue(key), 10);
        return isNaN(int) ? 0 : int;
      })
      .reduce(function (sum, value) {
        return sum + value;
      });
  }

  destroy() {
    this.removeListeners();
  }
}
