/*global $ */
define([
   "dojo/ready",
   "dojo/_base/declare",
    "dojo/on",
    "dojo/dom",
    "esri/request",
    "dojo/_base/array",
    "dojo/dom-construct",
    "dojo/dom-attr",
    "dojo/query",
    "dojo/dom-class",
    "dojo/_base/lang",
    "dojo/Deferred",
    "dojo/DeferredList",
    "dojo/number",
    "dijit/_WidgetBase",
    "dijit/_TemplatedMixin",
    "dojo/text!application/dijit/templates/modal.html",
    "dojo/text!application/dijit/templates/author.html",
    "application/builder/browseIdDlg",
    "application/ShareModal",
    "application/localStorageHelper",
    "application/builder/signInHelper",
    "dojo/i18n!application/nls/builder",
    "dojo/i18n!application/nls/resources",
    "esri/arcgis/utils",
    "application/themes",
    "esri/layers/FeatureLayer",
    "dojo/domReady!"
], function (ready, declare, on, dom, esriRequest, array, domConstruct, domAttr, query, domClass, lang, Deferred, DeferredList, number, _WidgetBase, _TemplatedMixin, modalTemplate, authorTemplate, BrowseIdDlg, ShareModal, localStorageHelper, signInHelper, nls, resources, arcgisUtils, theme, FeatureLayer) {
    return declare([_WidgetBase, _TemplatedMixin], {
        templateString: authorTemplate,
        nls: nls,
        currentState: "webmap",
        previousState: null,
        currentConfig: null,
        response: null,
        userInfo: null,
        browseDlg: null,
        fieldInfo: {},
        layerInfo: null,
        themes: theme,
        localStorageSupport: null,

        constructor: function (config, response) {
            this.config = config;
            this.response = response;
        },

        startup: function () {
            var def = new Deferred();
            var signIn = new signInHelper(), userInfo = {};
            signIn.createPortal().then(lang.hitch(this, function (loggedInUser) {
                var isValidUser = signIn.authenticateUser(true, this.response, loggedInUser);
                if (isValidUser) {
                    userInfo.username = loggedInUser.username;
                    userInfo.token = loggedInUser.credential.token;
                    userInfo.portal = signIn.getPortal();
                    this._initializeBuilder(this.config, userInfo, this.response);
                    this._setTabCaption();
                    domClass.remove(document.body, "app-loading");
                    def.resolve();
                }
                else {
                    def.reject(new Error("Invalid User"));
                }
            }), lang.hitch(this, function (error) {
                def.reject(error);
            }));
            return def.promise;
        },

        _initializeBuilder: function (config, userInfo, response) {
            // set to default theme. (first in array)
            dom.byId("themeLink").href = this.themes[0].url;
            dom.byId("parentContainter").appendChild(this.authorMode);
            var $tabs = $('.tab-links li');
            domClass.add($('.navigationTabs')[0], "activeTab");
            // document ready
            ready(lang.hitch(this, function () {
                modalTemplate = lang.replace(modalTemplate, resources);
                // place modal code
                domConstruct.place(modalTemplate, document.body, 'last');
            }));
            $('.prevtab').on('click', lang.hitch(this, function () {
                $tabs.filter('.active').prev('li').find('a[data-toggle="tab"]').tab('show');
            }));

            $('.nexttab').on('click', lang.hitch(this, function () {
                $tabs.filter('.active').next('li').find('a[data-toggle="tab"]').tab('show');
            }));

            $('.navigationTabs').on('click', lang.hitch(this, function (evt) {
                this._getPrevTabDetails(evt);
            }));

            $('#saveButton').on('click', lang.hitch(this, function () {
                this._updateItem();
            }));

            $('#done').on('click', lang.hitch(this, function () {
                var detailsPageURL = this.currentConfig.sharinghost + "/home/item.html?id=" + this.currentConfig.appid;
                window.open(detailsPageURL);
            }));

            $('#jumbotronOption').on('click', lang.hitch(this, function () {
                this.currentConfig.useSmallHeader = $('#jumbotronOption')[0].checked;
            }));
            $('#shareOption').on('click', lang.hitch(this, function () {
                this.currentConfig.enableSharing = $('#shareOption')[0].checked;
            }));

            this.currentConfig = config;
            this.userInfo = userInfo;
            this.response = response;
            this.localStorageSupport = new localStorageHelper();
            this._addOperationalLayers();
            this._populateDetails();
            this._populateJumbotronOption(this.currentConfig.useSmallHeader);
            this._populateShareOption(this.currentConfig.enableSharing);
            this._populateThemes();
            this._initWebmapSelection();
            this._loadCSS("css/browseDialog.css");
            if (!this.localStorageSupport.supportsStorage()) {
                array.forEach(query(".navigationTabs"), lang.hitch(this, function (currentTab) {
                    if (domAttr.get(currentTab, "tab") == "preview") {
                        this._disableTab(currentTab);
                    }
                }));
            }
            on(dom.byId("selectLayer"), "change", lang.hitch(this, function (evt) {
                this.currentConfig.form_layer.id = evt.currentTarget.value;
                this._populateFields(evt.currentTarget.value);
                if (evt.currentTarget.value == nls.builder.selectLayerDefaultOptionText) {
                    array.forEach(query(".navigationTabs"), lang.hitch(this, function (currentTab) {
                        if (domAttr.get(currentTab, "tab") == "fields" || domAttr.get(currentTab, "tab") == "preview" || domAttr.get(currentTab, "tab") == "publish" || domAttr.get(currentTab, "tab") == "options") {
                            this._disableTab(currentTab);
                        }
                    }));
                } else {
                    array.forEach(query(".navigationTabs"), lang.hitch(this, function (currentTab) {
                        if (domAttr.get(currentTab, "tab") == "fields" || ((domAttr.get(currentTab, "tab") === "preview" || domAttr.get(currentTab, "tab") === "publish" || domAttr.get(currentTab, "tab") == "options") && query(".fieldCheckbox:checked").length !== 0)) {
                            this._enableTab(currentTab);
                        }
                    }));
                }
            }));

            on(this.selectAll, "change", lang.hitch(this, function (evt) {
                array.forEach(query(".fieldCheckbox"), lang.hitch(this, function (currentCheckBox) {
                    currentCheckBox.checked = evt.currentTarget.checked;
                }));
                this._getFieldCheckboxState();
            }));
            /*
            $('.selectpicker').selectpicker();
            on($('.selectpicker'), 'change', lang.hitch(this, function (evt) {
            this.currentConfig.pushpinColor = evt.currentTarget.value;
            }));
            */
        },

        _setTabCaption: function () {
            //set sequence numbers to tabs
            array.forEach(query(".navbar-right")[0].children, lang.hitch(this, function (currentTab, index) {
                domAttr.set(currentTab.children[0], "innerHTML", number.format(++index) + ". " + currentTab.children[0].innerHTML);
            }));
            array.forEach(query(".nav-stacked")[0].children, lang.hitch(this, function (currentTab, index) {
                domAttr.set(currentTab.children[0], "innerHTML", number.format(++index) + ". " + currentTab.children[0].innerHTML);
            }));
        },

        //function to get the details of previously selected tab
        _getPrevTabDetails: function (evt) {
            if (evt) {
                this.previousState = this.currentState;
                this.currentState = evt.currentTarget.getAttribute("tab");
                this._updateAppConfiguration(this.previousState);
                if (this.currentState == "preview") {
                    require([
                       "application/main"
                      ], lang.hitch(this, function (userMode) {
                          var index = new userMode();
                          index.startup(this.currentConfig, this.response, true, query(".preview-frame")[0]);
                      }));
                } else {
                    localStorage.clear();
                }
            }
        },

        //function will validate and add operational layers in dropdown
        _addOperationalLayers: function () {
            var layerDefeeredListArr = [],
                layerDefeeredList, attribute;
            this._clearLayerOptions();
            array.forEach(this.currentConfig.itemInfo.itemData.operationalLayers, lang.hitch(this, function (currentLayer) {
                if (currentLayer.url && currentLayer.url.split("/")[currentLayer.url.split("/").length - 2].toLowerCase() == "featureserver") {
                    layerDefeeredListArr.push(this._queryLayer(currentLayer.url, currentLayer.id));
                }
            }));
            layerDefeeredList = new DeferredList(layerDefeeredListArr);
            layerDefeeredList.then(lang.hitch(this, function () {
                if (dom.byId("selectLayer").options.length <= 1) {
                    domAttr.set(dom.byId("selectLayer"), "disabled", true);
                    this._showErrorMessageDiv(nls.builder.invalidWebmapSelectionAlert);
                    array.forEach(query(".navigationTabs"), lang.hitch(this, function (currentTab) {
                        attribute = currentTab.getAttribute("tab");
                        if (attribute === "webmap" || attribute === "layer") {
                            this._enableTab(currentTab);
                        } else {
                            this._disableTab(currentTab);
                        }
                    }));
                } else {
                    array.forEach(query(".navigationTabs"), lang.hitch(this, function (currentTab) {
                        domConstruct.empty(this.erroMessageDiv);
                        attribute = currentTab.getAttribute("tab");
                        if (((attribute == "publish" || attribute == "preview") && (query(".fieldCheckbox:checked").length === 0)) || (attribute == "fields" && dom.byId("selectLayer").value === "Select Layer")) {
                            this._disableTab(currentTab);
                        } else {
                            this._enableTab(currentTab);
                        }
                    }));
                    domAttr.set(dom.byId("selectLayer"), "disabled", false);
                }
            }));
        },

        //function to set the title, logo-path and description from config
        _populateDetails: function () {
            dom.byId("detailTitleInput").value = this.currentConfig.details.Title;
            dom.byId("detailLogoInput").value = this.currentConfig.details.Logo;
            dom.byId("detailDescriptionInput").innerHTML = this.currentConfig.details.Description;
            array.some(dom.byId("pushpinInput").options, lang.hitch(this, function (currentOption) {
                if (currentOption.value == this.currentConfig.pushpinColor) {
                    currentOption.selected = "selected";
                    return true;
                }
            }));
            $(document).ready(function () {
                $('#detailDescriptionInput').summernote({
                    height: 200,
                    minHeight: null,
                    maxHeight: null,
                    focus: true
                });
            });
        },

        //function to populate all available themes in application
        _populateThemes: function () {
            var themesRadioButton, themesDivContainer, themesDivContent, themesLabel, themeThumbnail;
            array.forEach(this.themes, lang.hitch(this, function (currentTheme) {
                themesDivContainer = domConstruct.create("div", {
                    className: "col-md-4"
                }, this.stylesList);
                themesDivContent = domConstruct.create("div", {
                    className: "radio"
                }, themesDivContainer);
                themesLabel = domConstruct.create("label", {
                    innerHTML: currentTheme.name,
                    "for": currentTheme.id
                }, themesDivContent);
                themesRadioButton = domConstruct.create("input", {
                    type: "radio",
                    id: currentTheme.id,
                    name: "themesRadio",
                    themeName: currentTheme.id,
                    themeUrl: currentTheme.url
                }, themesLabel);
                if (currentTheme.id == this.currentConfig.theme) {
                    themesRadioButton.checked = true;
                }
                on(themesRadioButton, "change", lang.hitch(this, function (evt) {
                    this._configureTheme(evt);
                }));
                domConstruct.create("br", {}, themesLabel);
                themeThumbnail = domConstruct.create("img", {
                    src: currentTheme.thumbnail,
                    className: "themeThubnail"
                }, themesLabel);
                on(themeThumbnail, "click", function () {
                    window.open(currentTheme.refUrl);
                });
            }));
        },

        _populateJumbotronOption: function (jumbotronOption) {
            $("#jumbotronOption")[0].checked = jumbotronOption;
        },
        _populateShareOption: function (shareOption) {
            $("#shareOption")[0].checked = shareOption;
        },
        //function to select the previously configured theme.
        _configureTheme: function (selectedTheme) {
            this.currentConfig.theme = selectedTheme.currentTarget.getAttribute("themeName");
        },

        //function will populate all editable fields with validations
        _populateFields: function (layerName) {
            var configuredFields = [],
                configuredFieldName = [],
                fieldRow, fieldName, fieldLabel, fieldLabelInput, fieldDescription, fieldDescriptionInput, fieldCheckBox,
                fieldCheckBoxInput, currentIndex = 0,
                layerIndex, fieldDNDIndicatorTD, fieldDNDIndicatorIcon, matchingField = false,
                newAddedFields = [], sortedFields = [];
            if (this.geoFormFieldsTable) {
                domConstruct.empty(this.geoFormFieldsTable);
            }
            array.forEach(this.currentConfig.fields, lang.hitch(this, function (currentField) {
                configuredFieldName.push(currentField.fieldName);
                configuredFields.push(currentField);
            }));

            array.forEach(this.currentConfig.itemInfo.itemData.operationalLayers, lang.hitch(this, function (currentLayer, index) {
                if (this.fieldInfo[layerName]) {
                    if (this.fieldInfo[layerName].layerUrl == currentLayer.url) {
                        layerIndex = index;
                    }
                }
            }));
            if (this.fieldInfo[layerName]) {
                array.forEach(this.fieldInfo[layerName].Fields, lang.hitch(this, function (currentField) {
                    matchingField = false;
                    array.forEach(this.currentConfig.fields, lang.hitch(this, function (configLayerField) {
                        if ((currentField.editable && configLayerField.fieldName == currentField.name)) {
                            matchingField = true;
                            if (!(currentField.type === "esriFieldTypeOID" || currentField.type === "esriFieldTypeGeometry" || currentField.type === "esriFieldTypeBlob" || currentField.type === "esriFieldTypeRaster" || currentField.type === "esriFieldTypeGUID" || currentField.type === "esriFieldTypeGlobalID" || currentField.type === "esriFieldTypeXML")) {
                                newAddedFields.push(lang.mixin(currentField, configLayerField));
                            }
                        }
                    }));
                    if (!matchingField) {
                        if ((currentField.editable && !(currentField.type === "esriFieldTypeOID" || currentField.type === "esriFieldTypeGeometry" || currentField.type === "esriFieldTypeBlob" || currentField.type === "esriFieldTypeRaster" || currentField.type === "esriFieldTypeGUID" || currentField.type === "esriFieldTypeGlobalID" || currentField.type === "esriFieldTypeXML"))) {
                            currentField.visible = true;
                            currentField.isNewField = true;
                            newAddedFields.push(currentField);
                        }
                    }
                }));
            }

            array.forEach(this.currentConfig.fields, lang.hitch(this, function (configField) {
                array.some(newAddedFields, lang.hitch(this, function (currentField) {
                    if (currentField.fieldName === configField.fieldName) {
                        sortedFields.push(currentField);
                        return true;
                    }
                }));
            }));
            array.forEach(newAddedFields, lang.hitch(this, function (currentField) {
                if (sortedFields.indexOf(currentField) === -1) {
                    sortedFields.push(currentField);
                }

            }));
            //newAddedFields & this.currentConfig.fields
            array.forEach(sortedFields, lang.hitch(this, function (currentField) {
                fieldRow = domConstruct.create("tr", {
                    rowIndex: currentIndex
                }, this.geoFormFieldsTable);
                domAttr.set(fieldRow, "visibleProp", currentField.visible);
                fieldDNDIndicatorTD = domConstruct.create("td", {}, fieldRow);
                fieldDNDIndicatorIcon = domConstruct.create("span", {
                    className: "ui-icon ui-icon-arrowthick-2-n-s"
                }, fieldDNDIndicatorTD);
                fieldCheckBox = domConstruct.create("td", {}, fieldRow);
                fieldCheckBoxInput = domConstruct.create("input", {
                    className: "fieldCheckbox",
                    type: "checkbox",
                    index: currentIndex
                }, fieldCheckBox);
                domAttr.set(fieldCheckBoxInput, "checked", currentField.visible);

                on(fieldCheckBoxInput, "change", lang.hitch(this, function () {
                    if (query(".fieldCheckbox:checked").length == query(".fieldCheckbox").length) {
                        this.selectAll.checked = true;
                    } else {
                        this.selectAll.checked = false;
                    }
                    this._getFieldCheckboxState();
                }));

                fieldName = domConstruct.create("td", {
                    className: "fieldName layerFieldsName",
                    innerHTML: currentField.name,
                    index: currentIndex
                }, fieldRow);
                fieldLabel = domConstruct.create("td", {
                    className: "tableDimension"
                }, fieldRow);
                fieldLabelInput = domConstruct.create("input", {
                    className: "form-control fieldLabel",
                    index: currentIndex,
                    placeholder: nls.builder.fieldLabelPlaceHolder,
                    value: currentField.alias
                }, fieldLabel);
                fieldDescription = domConstruct.create("td", {
                    className: "tableDimension"
                }, fieldRow);
                fieldDescriptionInput = domConstruct.create("input", {
                    className: "form-control fieldDescription",
                    placeholder: nls.builder.fieldDescPlaceHolder,
                    value: ""
                }, fieldDescription);
                fieldPlaceholder = domConstruct.create("td", {
                    className: "tableDimension"
                }, fieldRow);

                if (!currentField.domain) {
                    fieldPlaceholderInput = domConstruct.create("input", {
                        className: "form-control fieldPlaceholder",
                        index: currentIndex
                    }, fieldPlaceholder);
                    if (currentField.placeHolder) {
                        fieldPlaceholderInput.value = currentField.placeHolder;
                    }
                }
                fieldType = domConstruct.create("td", {
                    style: "min-width: 100px",
                    className: "fieldSqlType",
                    innerHTML: currentField.type.replace("esriFieldType", "")
                }, fieldRow);
                if (this.currentConfig.itemInfo.itemData.operationalLayers[layerIndex].popupInfo) {
                    array.forEach(this.currentConfig.itemInfo.itemData.operationalLayers[layerIndex].popupInfo.fieldInfos, function (currentFieldPopupInfo) {
                        if (currentFieldPopupInfo.fieldName == currentField.name) {
                            if (currentFieldPopupInfo.tooltip) {
                                fieldDescriptionInput.value = currentFieldPopupInfo.tooltip;
                            }
                        }
                    });
                }
                currentIndex++;
                if (currentField.isNewField) {
                    domAttr.set(fieldLabelInput, "value", currentField.alias);
                } else {
                    domAttr.set(fieldLabelInput, "value", currentField.fieldLabel);
                }
                if (currentField.fieldDescription) {
                    domAttr.set(fieldDescriptionInput, "value", currentField.fieldDescription);
                }
            }));
            if (query(".fieldCheckbox:checked").length == query(".fieldCheckbox").length) {
                this.selectAll.checked = true;
            } else {
                this.selectAll.checked = false;
            }
            $(document).ready(function () {
                $("#tbodyDND").sortable({});
            });
            this._updateAppConfiguration("fields");
        },

        //function to fetch the datatype of the field
        _createFieldDataTypeOptions: function (currentField, fieldTypeSelect) {
            var fieldTypeSelectOption;
            fieldTypeSelectOption = domConstruct.create("option", {}, null);
            fieldTypeSelectOption.text = currentField.type.split("esriFieldType")[1];
            fieldTypeSelectOption.value = currentField.type.split("esriFieldType")[1];
            fieldTypeSelect.appendChild(fieldTypeSelectOption);
        },

        //function to query layer in order to obtain all the information of layer
        _queryLayer: function (layerUrl, layerId) {
            var capabilities = null;
            var layer = new FeatureLayer(layerUrl);
            var layerDeferred = new Deferred();
            on(layer, "load", lang.hitch(this, function () {
                capabilities = layer.getEditCapabilities();
                this._validateFeatureServer(layer, capabilities.canCreate, layerId);
                layerDeferred.resolve(true);
            }));
            on(layer, "error", function () {
                layerDeferred.resolve(true);
            });
            return layerDeferred.promise;
        },

        //function to filter editable layers from all the layers in webmap
        _validateFeatureServer: function (layer, canCreate, layerId) {
            if (canCreate) {
                var filteredLayer;
                filteredLayer = document.createElement("option");
                filteredLayer.text = layer.name;
                filteredLayer.value = layerId;
                dom.byId("selectLayer").appendChild(filteredLayer);
                this.fieldInfo[layerId] = {};
                this.fieldInfo[layerId].Fields = layer.fields;
                this.fieldInfo[layerId].layerUrl = layer.url;
                if (layer.templates[0]) {
                    this.fieldInfo[layerId].defaultValues = layer.templates[0].prototype.attributes;
                }
                if (layerId == this.currentConfig.form_layer.id) {
                    this._populateFields(layerId);
                    filteredLayer.selected = "selected";
                }
            }
        },

        //function to allow user to udate/select webmap from the list
        _initWebmapSelection: function () {
            var browseParams = {
                portal: this.userInfo.portal,
                galleryType: "webmap" //valid values are webmap or group
            };
            this.browseDlg = new BrowseIdDlg(browseParams, this.userInfo);
            on(this.browseDlg, "close", lang.hitch(this, function () {
                if (this.browseDlg.get("selected") !== null && this.browseDlg.get("selectedWebmap") !== null) {
                    if (this.browseDlg.get("selectedWebmap").thumbnailUrl) {
                        domAttr.set(query(".img-thumbnail")[0], "src", this.browseDlg.get("selectedWebmap").thumbnailUrl);
                        this.currentConfig.webmapThumbnailUrl = this.browseDlg.get("selectedWebmap").thumbnailUrl;
                    } else {
                        domAttr.set(query(".img-thumbnail")[0], "src", "./images/default.png");
                    }
                    this.currentConfig.webmap = this.browseDlg.get("selectedWebmap").id;
                    dom.byId("webmapLink").href = this.userInfo.portal.url + "/home/webmap/viewer.html?webmap=" + this.currentConfig.webmap;
                    var btn = $(dom.byId("selectWebmapBtn"));
                    btn.button('loading');
                    arcgisUtils.getItem(this.currentConfig.webmap).then(lang.hitch(this, function (itemInfo) {
                        this.currentConfig.fields.length = 0;
                        this.currentConfig.form_layer.id = "";
                        domConstruct.empty(this.geoFormFieldsTable);
                        this.currentConfig.itemInfo = itemInfo;
                        this._addOperationalLayers();
                        btn.button('reset');
                    }), function (error) {
                        console.log(error);
                    });
                }
            }));

            on(dom.byId("selectWebmapBtn"), "click", lang.hitch(this, function () {
                this.browseDlg.show();
            }));

            if (this.currentConfig.itemInfo.item.thumbnail) {
                domAttr.set(query(".img-thumbnail")[0], "src", this.currentConfig.sharinghost + "/sharing/rest/content/items/" + this.currentConfig.webmap + "/info/" + this.currentConfig.itemInfo.item.thumbnail + "?token=" + this.userInfo.token);
            } else {
                domAttr.set(query(".img-thumbnail")[0], "src", "./images/default.png");
            }
            dom.byId("webmapLink").href = this.userInfo.portal.url + "/home/webmap/viewer.html?webmap=" + this.currentConfig.webmap;
        },

        //function to load the css on runtime
        _loadCSS: function (sourcePath) {
            //Load browser dialog
            var cssStyle = document.createElement('link');
            cssStyle.rel = 'stylesheet';
            cssStyle.type = 'text/css';
            cssStyle.href = sourcePath;
            document.getElementsByTagName('head')[0].appendChild(cssStyle);
        },

        //function to remove all the layers from the select box
        _clearLayerOptions: function () {
            var i;
            for (i = dom.byId("selectLayer").options.length - 1; i >= 0; i--) {
                if (dom.byId("selectLayer").options[i].value != "Select Layer") {
                    dom.byId("selectLayer").remove(i);
                }
            }
        },

        //function takes the previous tab's details as input parameter and saves the setting to config
        _updateAppConfiguration: function (prevNavigationTab) {
            switch (prevNavigationTab) {
                case "webmap":
                    break;
                case "details":
                    this.currentConfig.details.Title = dom.byId("detailTitleInput").value;
                    this.currentConfig.details.Logo = dom.byId("detailLogoInput").value;
                    this.currentConfig.details.Description = $('#detailDescriptionInput').code();
                    break;
                case "fields":
                    this.currentConfig.fields.length = 0;
                    var index, fieldName, fieldLabel, fieldDescription, layerName, visible, defaultValue;
                    layerName = dom.byId("selectLayer").value;
                    array.forEach($("#tableDND")[0].rows, lang.hitch(this, function (currentRow, index) {
                        if (currentRow.getAttribute("rowIndex")) {
                            index = currentRow.getAttribute("rowIndex");
                            fieldName = query(".layerFieldsName", currentRow)[0].innerHTML;
                            for (var key in this.fieldInfo[this.currentConfig.form_layer.id].defaultValues) {
                                if (key == fieldName) {
                                    defaultValue = this.fieldInfo[this.currentConfig.form_layer.id].defaultValues[key];
                                    break;
                                }
                            }
                            fieldLabel = query(".fieldLabel", currentRow)[0].value;
                            fieldDescription = query(".fieldDescription", currentRow)[0].value;
                            visible = query(".fieldCheckbox", currentRow)[0].checked;
                            this.currentConfig.fields.push({
                                fieldName: fieldName,
                                fieldLabel: fieldLabel,
                                fieldDescription: fieldDescription,
                                visible: visible,
                                defaultValue: defaultValue
                            });
                            if (query(".fieldPlaceholder", currentRow)[0]) {
                                this.currentConfig.fields[index].placeHolder = query(".fieldPlaceholder", currentRow)[0].value;
                            }
                        }
                    }));
                    break;
                default:
            }
        },

        //function to update the item on arcGis online
        _updateItem: function () {
            this.currentConfig.edit = "";
            lang.mixin(this.response.itemData.values, this.currentConfig);
            delete this.response.itemData.values.itemInfo;
            this.response.item.tags = typeof (this.response.item.tags) == "object" ? this.response.item.tags.join(',') : this.response.item.tags;
            this.response.item.typeKeywords = typeof (this.response.item.typeKeywords) == "object" ? this.response.item.typeKeywords.join(',') : this.response.item.typeKeywords;
            var rqData = lang.mixin(this.response.item, {
                id: this.currentConfig.appid,
                item: this.currentConfig.appid,
                itemType: "text",
                f: 'json',
                token: this.userInfo.token,
                title: this.currentConfig.details.Title ? this.currentConfig.details.Title : nls.builder.geoformTitleText,
                text: JSON.stringify(this.response.itemData),
                type: "Web Mapping Application",
                overwrite: true
            });
            this._addProgressBar();
            $("#myModal").modal('show');
            arcgisUtils.getItem(this.currentConfig.appid).then(lang.hitch(this, function (response) {
                var updateURL = this.userInfo.portal.url + "/sharing/content/users/" + this.userInfo.username + (response.item.ownerFolder ? ("/" + response.item.ownerFolder) : "") + "/items/" + this.currentConfig.appid + "/update";
                esriRequest({
                    url: updateURL,
                    content: rqData,
                    handleAs: 'json'
                }, {
                    usePost: true
                }).then(lang.hitch(this, function (result) {
                    if (result.success) {
                        this._createShareDlgContent();
                        this._ShareModal = new ShareModal({
                            bitlyLogin: this.currentConfig.bitlyLogin,
                            bitlyKey: this.currentConfig.bitlyKey,
                            image: this.currentConfig.sharinghost + '/sharing/rest/content/items/' + this.currentConfig.itemInfo.item.id + '/info/' + this.currentConfig.itemInfo.item.thumbnail,
                            title: this.currentConfig.details.Title || nls.builder.geoformTitleText || '',
                            summary: this.currentConfig.details.Description || '',
                            hashtags: 'esriGeoForm',
                            shareOption: this.currentConfig.enableSharing
                        });
                        this._ShareModal.startup();
                    }
                }), function () {
                    $("#myModal").modal('hide');
                });
            }));
        },

        //function to show a progress bar before the content of share dialog is loaded
        _addProgressBar: function () {
            var progressIndicatorContainer, progressIndicator;
            domConstruct.empty($("#myModal .modal-body")[0]);
            domAttr.set(dom.byId('myModalLabel'), "innerHTML", nls.builder.shareBuilderInProgressTitleMessage);
            progressIndicatorContainer = domConstruct.create("div", {
                className: "progress progress-striped active progress-remove-margin"
            }, $("#myModal .modal-body")[0]);
            progressIndicator = domConstruct.create("div", {
                className: "progress-bar progress-percent",
                innerHTML: nls.builder.shareBuilderProgressBarMessage
            }, progressIndicatorContainer);
        },
        _createShareDlgContent: function () {
            var iconContainer, facebookIconHolder, twitterIconHolder, googlePlusIconHolder, mailIconHolder;
            domConstruct.empty($("#myModal .modal-body")[0]);
            domAttr.set(dom.byId('myModalLabel'), "innerHTML", nls.builder.shareBuilderTitleMessage);
            iconContainer = domConstruct.create("div", {
                className: "iconContainer"
            }, $("#myModal .modal-body")[0]);
            domConstruct.create("div", {
                className: "share-dialog-subheader",
                innerHTML: nls.builder.shareBuilderTextMessage
            }, iconContainer);
            if ($("#shareOption")[0].checked) {
                facebookIconHolder = domConstruct.create("div", {
                    className: "iconContent"
                }, iconContainer);
                domConstruct.create("a", {
                    className: "fa fa-facebook-square iconClass",
                    id: "facebookIcon"
                }, facebookIconHolder);
                twitterIconHolder = domConstruct.create("div", {
                    className: "iconContent"
                }, iconContainer);
                domConstruct.create("a", {
                    className: "fa fa-twitter-square iconClass",
                    id: "twitterIcon"
                }, twitterIconHolder);
                googlePlusIconHolder = domConstruct.create("div", {
                    className: "iconContent"
                }, iconContainer);
                domConstruct.create("a", {
                    className: "fa fa-google-plus-square iconClass",
                    id: "google-plusIcon"
                }, googlePlusIconHolder);
            }
            mailIconHolder = domConstruct.create("div", {
                className: "iconContent"
            }, iconContainer);
            domConstruct.create("a", {
                className: "fa fa-envelope iconClass",
                id: "mailIcon"
            }, mailIconHolder);
            domConstruct.create("br", {}, iconContainer);
            domConstruct.create("br", {}, iconContainer);
            domConstruct.create("br", {}, iconContainer);
            domConstruct.create("div", {
                className: "share-dialog-subheader",
                innerHTML: nls.builder.shareModalFormText
            }, iconContainer);
            domConstruct.create("input", {
                type: "text",
                className: "share-map-url",
                id: "_shareMapUrlText"
            }, iconContainer);
        },
        //function to enable the tab passed in input parameter
        _enableTab: function (currentTab) {
            if (!this.localStorageSupport.supportsStorage() && domAttr.get(currentTab, "tab") == "preview")
                return;
            if (domClass.contains(currentTab, "btn")) {
                domClass.remove(currentTab, "disabled");
            } else {
                domClass.remove(currentTab.parentNode, "disabled");
            }
            domAttr.set(currentTab, "data-toggle", "tab");
        },

        //function to disable the tab passed in input parameter
        _disableTab: function (currentTab) {
            if (domClass.contains(currentTab, "btn")) {
                domClass.add(currentTab, "disabled");
            } else {
                domClass.add(currentTab.parentNode, "disabled");
            }
            domAttr.set(currentTab, "data-toggle", "");
        },

        _getFieldCheckboxState: function () {
            array.forEach(query(".navigationTabs"), lang.hitch(this, function (currentTab) {
                if ((domAttr.get(currentTab, "tab") === "preview" || domAttr.get(currentTab, "tab") === "publish") && (query(".fieldCheckbox:checked").length === 0)) {
                    this._disableTab(currentTab);
                } else {
                    this._enableTab(currentTab);
                }
            }));
        },

        _showErrorMessageDiv: function (errorMessage) {
            domConstruct.empty(this.erroMessageDiv);
            domConstruct.create("div", {
                className: "alert alert-danger errorMessage",
                innerHTML: errorMessage
            }, this.erroMessageDiv);
        }
    });
});