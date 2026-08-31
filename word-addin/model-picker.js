/* Searchable model selector shared by every Word add-in surface. */
(function () {
  'use strict';

  var instances = [];

  function normalizeSearch(value) {
    var normalized = String(value || '').toLocaleLowerCase();
    try { normalized = normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (error) { /* older webviews */ }
    return normalized.trim().replace(/\s+/g, ' ');
  }

  function dispatchChange(select) {
    var event;
    try {
      event = new Event('change', { bubbles: true });
    } catch (error) {
      event = document.createEvent('Event');
      event.initEvent('change', true, false);
    }
    select.dispatchEvent(event);
  }

  function enhance(select, options) {
    if (!select) return null;
    if (select.__nodusModelPicker) return select.__nodusModelPicker;
    options = options || {};

    var root = document.createElement('div');
    root.className = 'model-picker';
    var input = document.createElement('input');
    input.id = select.id + 'Search';
    input.className = 'model-picker-search';
    input.type = 'search';
    input.autocomplete = 'off';
    input.placeholder = options.searchPlaceholder || 'Search models';
    input.setAttribute('aria-label', options.searchPlaceholder || 'Search models');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    var toggle = document.createElement('button');
    toggle.className = 'model-picker-toggle';
    toggle.type = 'button';
    toggle.setAttribute('aria-label', options.showOptionsLabel || input.placeholder);
    toggle.innerHTML = '<span aria-hidden="true"></span>';
    var list = document.createElement('div');
    list.id = select.id + 'Options';
    list.className = 'model-picker-options';
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    input.setAttribute('aria-controls', list.id);
    toggle.setAttribute('aria-controls', list.id);
    toggle.setAttribute('aria-expanded', 'false');
    root.appendChild(input);
    root.appendChild(toggle);
    root.appendChild(list);
    select.parentNode.insertBefore(root, select.nextSibling);
    select.hidden = true;
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');

    var visibleOptions = [];
    var activeIndex = -1;

    function selectedLabel() {
      var selected = select.options[select.selectedIndex];
      return selected ? selected.textContent : '';
    }

    function setExpanded(expanded) {
      root.classList.toggle('open', expanded);
      list.hidden = !expanded;
      input.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      if (!expanded) {
        activeIndex = -1;
        input.removeAttribute('aria-activedescendant');
        input.value = selectedLabel();
      }
    }

    function setActive(index) {
      if (!visibleOptions.length) return;
      activeIndex = Math.max(0, Math.min(visibleOptions.length - 1, index));
      visibleOptions.forEach(function (button, buttonIndex) {
        button.classList.toggle('active', buttonIndex === activeIndex);
      });
      var active = visibleOptions[activeIndex];
      input.setAttribute('aria-activedescendant', active.id);
      if (active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
    }

    function choose(value) {
      if (select.value !== value) {
        select.value = value;
        dispatchChange(select);
      }
      setExpanded(false);
      input.focus();
      input.select();
    }

    function render(query) {
      var normalized = normalizeSearch(query);
      var selectedVisibleIndex = -1;
      list.innerHTML = '';
      visibleOptions = [];
      activeIndex = -1;
      Array.prototype.forEach.call(select.options, function (option, index) {
        var label = String(option.textContent || '');
        if (normalized && normalizeSearch(label).indexOf(normalized) < 0) return;
        var button = document.createElement('button');
        button.id = select.id + 'Option' + index;
        button.type = 'button';
        button.className = 'model-picker-option';
        button.setAttribute('role', 'option');
        button.setAttribute('aria-selected', option.value === select.value ? 'true' : 'false');
        button.textContent = label;
        button.disabled = option.disabled;
        button.onmousedown = function (event) { event.preventDefault(); };
        button.onclick = function () { choose(option.value); };
        list.appendChild(button);
        visibleOptions.push(button);
        if (option.value === select.value) selectedVisibleIndex = visibleOptions.length - 1;
      });
      if (!visibleOptions.length) {
        var empty = document.createElement('div');
        empty.className = 'model-picker-empty';
        empty.textContent = options.noResults || 'No matching models';
        list.appendChild(empty);
      } else {
        setActive(selectedVisibleIndex >= 0 ? selectedVisibleIndex : 0);
      }
    }

    function openPicker(showAll) {
      if (select.disabled || !select.options.length) return;
      if (showAll) input.value = '';
      render(input.value);
      setExpanded(true);
    }

    function refresh() {
      input.disabled = select.disabled;
      toggle.disabled = select.disabled;
      input.value = selectedLabel();
      input.placeholder = options.searchPlaceholder || input.placeholder;
      if (!list.hidden) render(input.value);
    }

    input.onfocus = function () {
      openPicker(true);
      input.select();
    };
    input.onclick = function () {
      if (list.hidden) openPicker(true);
      input.select();
    };
    input.oninput = function () {
      render(input.value);
      setExpanded(true);
    };
    input.onkeydown = function (event) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (list.hidden) openPicker(true);
        setActive(activeIndex + 1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (list.hidden) openPicker(true);
        setActive(activeIndex < 0 ? visibleOptions.length - 1 : activeIndex - 1);
      } else if (event.key === 'Enter' && !list.hidden && activeIndex >= 0) {
        event.preventDefault();
        visibleOptions[activeIndex].click();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        setExpanded(false);
      }
    };
    toggle.onclick = function () {
      if (list.hidden) {
        openPicker(true);
        input.focus();
      } else {
        setExpanded(false);
      }
    };
    select.addEventListener('change', refresh);
    document.addEventListener('mousedown', function (event) {
      if (!root.contains(event.target)) setExpanded(false);
    });

    var observer = typeof MutationObserver !== 'undefined'
      ? new MutationObserver(refresh)
      : null;
    if (observer) observer.observe(select, { childList: true, subtree: true, attributes: true });

    var instance = { refresh: refresh, root: root, input: input, list: list };
    select.__nodusModelPicker = instance;
    instances.push(instance);
    refresh();
    return instance;
  }

  function refresh(select) {
    if (select && select.__nodusModelPicker) select.__nodusModelPicker.refresh();
  }

  window.NodusModelPicker = {
    enhance: enhance,
    refresh: refresh,
    refreshAll: function () { instances.forEach(function (instance) { instance.refresh(); }); },
  };
})();
