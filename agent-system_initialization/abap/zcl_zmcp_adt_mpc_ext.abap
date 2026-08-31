*----------------------------------------------------------------------*
*  ZCL_ZMCP_ADT_MPC_EXT — OData model provider extension
*  Paste into SE24 class ZCL_ZMCP_ADT_MPC_EXT (SEGW project ZMCP_ADT)
*  INHERITING FROM zcl_zmcp_adt_mpc  (SEGW-generated base, do not touch)
*
*  ⚠️ CRITICAL (adt-dev/src/lib/odataRfc.ts, fixed 2026-04-22):
*  Every action MUST call BOTH set_return_complex_type() AND
*  set_return_multiplicity( '1' ). If multiplicity is missing, $metadata
*  omits the ReturnType attribute and every POST fails with
*  HTTP 500 "unknown internal server error".
*----------------------------------------------------------------------*
CLASS zcl_zmcp_adt_mpc_ext DEFINITION
  PUBLIC
  INHERITING FROM zcl_zmcp_adt_mpc
  CREATE PUBLIC.

  PUBLIC SECTION.
    METHODS define REDEFINITION.

  PROTECTED SECTION.
  PRIVATE SECTION.
    METHODS define_dispatch_result
      RAISING /iwbep/cx_mgw_med_exception.
    METHODS define_textpool_result
      RAISING /iwbep/cx_mgw_med_exception.
    METHODS define_dispatch_action
      RAISING /iwbep/cx_mgw_med_exception.
    METHODS define_textpool_action
      RAISING /iwbep/cx_mgw_med_exception.
ENDCLASS.


CLASS zcl_zmcp_adt_mpc_ext IMPLEMENTATION.

  METHOD define.
    super->define( ).
    define_dispatch_result( ).
    define_textpool_result( ).
    define_dispatch_action( ).
    define_textpool_action( ).
  ENDMETHOD.

  METHOD define_dispatch_result.
    DATA lo_cmplx TYPE REF TO /iwbep/if_mgw_odata_cmplx_type.

    lo_cmplx = model->create_complex_type( iv_cplx_type_name = 'DispatchResult' ).

    lo_cmplx->create_property(
      iv_property_name  = 'EV_RESULT'
      iv_abap_fieldname = 'EV_RESULT' )->set_type_edm_string( ).

    lo_cmplx->create_property(
      iv_property_name  = 'EV_SUBRC'
      iv_abap_fieldname = 'EV_SUBRC' )->set_type_edm_int32( ).

    lo_cmplx->create_property(
      iv_property_name  = 'EV_MESSAGE'
      iv_abap_fieldname = 'EV_MESSAGE' )->set_type_edm_string( ).
  ENDMETHOD.

  METHOD define_textpool_result.
    DATA lo_cmplx TYPE REF TO /iwbep/if_mgw_odata_cmplx_type.

    lo_cmplx = model->create_complex_type( iv_cplx_type_name = 'TextpoolResult' ).

    lo_cmplx->create_property(
      iv_property_name  = 'EV_RESULT'
      iv_abap_fieldname = 'EV_RESULT' )->set_type_edm_string( ).

    lo_cmplx->create_property(
      iv_property_name  = 'EV_SUBRC'
      iv_abap_fieldname = 'EV_SUBRC' )->set_type_edm_int32( ).

    lo_cmplx->create_property(
      iv_property_name  = 'EV_MESSAGE'
      iv_abap_fieldname = 'EV_MESSAGE' )->set_type_edm_string( ).
  ENDMETHOD.

  METHOD define_dispatch_action.
    DATA lo_action TYPE REF TO /iwbep/if_mgw_odata_action.

    lo_action = model->create_action( iv_action_name = 'Dispatch' ).
    lo_action->set_return_complex_type( iv_complex_type_name = 'DispatchResult' ).
    lo_action->set_return_multiplicity( '1' ).   "<- REQUIRED, see header
    lo_action->set_http_method( iv_method_name = 'POST' ).

    lo_action->create_input_parameter(
      iv_parameter_name = 'IV_ACTION'
      iv_abap_fieldname = 'IV_ACTION' )->/iwbep/if_mgw_odata_property~set_type_edm_string( ).

    lo_action->create_input_parameter(
      iv_parameter_name = 'IV_PARAMS'
      iv_abap_fieldname = 'IV_PARAMS' )->/iwbep/if_mgw_odata_property~set_type_edm_string( ).
  ENDMETHOD.

  METHOD define_textpool_action.
    DATA lo_action TYPE REF TO /iwbep/if_mgw_odata_action.

    lo_action = model->create_action( iv_action_name = 'Textpool' ).
    lo_action->set_return_complex_type( iv_complex_type_name = 'TextpoolResult' ).
    lo_action->set_return_multiplicity( '1' ).   "<- REQUIRED, see header
    lo_action->set_http_method( iv_method_name = 'POST' ).

    lo_action->create_input_parameter(
      iv_parameter_name = 'IV_ACTION'
      iv_abap_fieldname = 'IV_ACTION' )->/iwbep/if_mgw_odata_property~set_type_edm_string( ).

    lo_action->create_input_parameter(
      iv_parameter_name = 'IV_PROGRAM'
      iv_abap_fieldname = 'IV_PROGRAM' )->/iwbep/if_mgw_odata_property~set_type_edm_string( ).

    lo_action->create_input_parameter(
      iv_parameter_name = 'IV_LANGUAGE'
      iv_abap_fieldname = 'IV_LANGUAGE' )->/iwbep/if_mgw_odata_property~set_type_edm_string( ).

    lo_action->create_input_parameter(
      iv_parameter_name = 'IV_TEXTPOOL_JSON'
      iv_abap_fieldname = 'IV_TEXTPOOL_JSON' )->/iwbep/if_mgw_odata_property~set_type_edm_string( ).
  ENDMETHOD.

ENDCLASS.
