*----------------------------------------------------------------------*
*  ZCL_ZMCP_ADT_DPC_EXT — OData data provider extension
*  Paste into SE24 class ZCL_ZMCP_ADT_DPC_EXT (SEGW project ZMCP_ADT)
*  INHERITING FROM zcl_zmcp_adt_dpc  (SEGW-generated base, do not touch)
*
*  Routes FunctionImport Dispatch/Textpool to the existing RFC-enabled
*  function modules ZMCP_ADT_DISPATCH / ZMCP_ADT_TEXTPOOL.
*----------------------------------------------------------------------*
CLASS zcl_zmcp_adt_dpc_ext DEFINITION
  PUBLIC
  INHERITING FROM zcl_zmcp_adt_dpc
  CREATE PUBLIC.

  PUBLIC SECTION.
    METHODS /iwbep/if_mgw_appl_srv_runtime~execute_action REDEFINITION.

  PROTECTED SECTION.
  PRIVATE SECTION.

    TYPES:
      BEGIN OF ty_result,
        ev_result  TYPE string,
        ev_subrc   TYPE i,
        ev_message TYPE string,
      END OF ty_result.

    METHODS exec_dispatch
      IMPORTING it_parameter     TYPE /iwbep/t_mgw_name_value_pair
      RETURNING VALUE(rs_result) TYPE ty_result.

    METHODS exec_textpool
      IMPORTING it_parameter     TYPE /iwbep/t_mgw_name_value_pair
      RETURNING VALUE(rs_result) TYPE ty_result.

ENDCLASS.


CLASS zcl_zmcp_adt_dpc_ext IMPLEMENTATION.

  METHOD /iwbep/if_mgw_appl_srv_runtime~execute_action.

    CASE iv_action_name.
      WHEN 'Dispatch'.
        DATA(ls_d) = exec_dispatch( it_parameter ).
        copy_data_to_ref( EXPORTING is_data = ls_d CHANGING cr_data = er_data ).

      WHEN 'Textpool'.
        DATA(ls_t) = exec_textpool( it_parameter ).
        copy_data_to_ref( EXPORTING is_data = ls_t CHANGING cr_data = er_data ).

      WHEN OTHERS.
        RAISE EXCEPTION TYPE /iwbep/cx_mgw_tech_exception.
    ENDCASE.

  ENDMETHOD.

  METHOD exec_dispatch.
    DATA lv_action TYPE string.
    DATA lv_params TYPE string.

    LOOP AT it_parameter ASSIGNING FIELD-SYMBOL(<ls_p>).
      CASE <ls_p>-name.
        WHEN 'IV_ACTION'. lv_action = <ls_p>-value.
        WHEN 'IV_PARAMS'. lv_params = <ls_p>-value.
      ENDCASE.
    ENDLOOP.

    CALL FUNCTION 'ZMCP_ADT_DISPATCH'
      EXPORTING
        iv_action  = lv_action
        iv_params  = lv_params
      IMPORTING
        ev_subrc   = rs_result-ev_subrc
        ev_message = rs_result-ev_message
        ev_result  = rs_result-ev_result.
  ENDMETHOD.

  METHOD exec_textpool.
    DATA lv_action   TYPE string.
    DATA lv_program  TYPE string.
    DATA lv_language TYPE string.
    DATA lv_tp_json  TYPE string.

    LOOP AT it_parameter ASSIGNING FIELD-SYMBOL(<ls_p>).
      CASE <ls_p>-name.
        WHEN 'IV_ACTION'.        lv_action   = <ls_p>-value.
        WHEN 'IV_PROGRAM'.       lv_program  = <ls_p>-value.
        WHEN 'IV_LANGUAGE'.      lv_language = <ls_p>-value.
        WHEN 'IV_TEXTPOOL_JSON'. lv_tp_json  = <ls_p>-value.
      ENDCASE.
    ENDLOOP.

    CALL FUNCTION 'ZMCP_ADT_TEXTPOOL'
      EXPORTING
        iv_action        = lv_action
        iv_program       = lv_program
        iv_language      = lv_language
        iv_textpool_json = lv_tp_json
      IMPORTING
        ev_subrc   = rs_result-ev_subrc
        ev_message = rs_result-ev_message
        ev_result  = rs_result-ev_result.
  ENDMETHOD.

ENDCLASS.
